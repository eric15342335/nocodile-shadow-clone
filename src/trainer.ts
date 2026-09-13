import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "./design-system";
import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import type WaButton from "@awesome.me/webawesome/dist/components/button/button.js";
import type WaProgressBar from "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import type WaDialog from "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import "../trainer.css";
import * as tf from "@tensorflow/tfjs";
import { element, context2d } from "./dom";
import { extractFeatures, FEATURE_SIZE } from "./features";
import { HandCamera } from "./hand-camera";
import { COLLECTION, classCounts, readyToTrain, type ClassLabel } from "./collection";
import {
  loadDataset,
  saveDataset,
  loadActiveRecord,
  publishCandidate,
  clearAppState,
  loadStateStamp,
  type Dataset,
  type ModelRecord,
  type Clip,
} from "./storage";
import { trainClassifier, predictScore, TRAINING_EPOCHS } from "./classifier";
import { GestureTrigger } from "./trigger";
import { storageFailureMessage } from "./recovery";
import { subscribeAppStateChanges } from "./state-sync";
import { CloneEffect, CLONE_EFFECT_DURATION_MS } from "./clone-effect";

let dataset: Dataset = { revision: 0, clips: [] };
let persistedRevision = 0;
let record: ModelRecord | null = null;
let model: tf.LayersModel | null = null;
let busy: "booting" | "idle" | "recording" | "saving" | "training" = "booting";
let storageBlocked = false;
let dirty = false;
let staleExternal = false;
let cameraReady = false;
let cameraStarted = false;
let disposed = false;
let editingExamples = true;
let trainingAbort: AbortController | null = null;
let effectTimer: ReturnType<typeof setTimeout> | null = null;
let latest: number[] | null = null;
let lastUi = 0;
const practiceTrigger = new GestureTrigger();
let recording: {
  label: ClassLabel;
  frames: number[][];
  lastCapture: number;
  startsAt: number;
  endsAt: number;
  startTimer: ReturnType<typeof setTimeout>;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

const button = (id: string) => element<WaButton>(id);
const progress = (id: string) => element<WaProgressBar>(id);
const dialog = (id: string) => element<WaDialog>(id);
const say = (id: string, text: string) => {
  const node = element(id);
  node.textContent = text;
  if (node.hasAttribute("data-auto-hide")) node.hidden = text.length === 0;
};

const video = element<HTMLVideoElement>("trainer-video");
const canvas = element<HTMLCanvasElement>("trainer-canvas");
const ctx = context2d(canvas);
const cloneEffect = new CloneEffect(element<HTMLImageElement>("effect-overlay"));

function enableTestingRuntime(): void {
  cloneEffect.enableSegmentation();
  camera.setFrameProcessor((frame) => cloneEffect.process(frame));
}

function finishCloneEffect(): void {
  if (effectTimer) clearTimeout(effectTimer);
  effectTimer = null;
  cloneEffect.reset();
  practiceTrigger.requireRelease(performance.now());
  say("practice-status", "Release to re-arm.");
  render();
}

function startCloneEffect(now: number): void {
  if (!cloneEffect.start(now)) {
    practiceTrigger.arm();
    say("practice-status", "Effect loading.");
    return;
  }
  if (effectTimer) clearTimeout(effectTimer);
  effectTimer = setTimeout(finishCloneEffect, CLONE_EFFECT_DURATION_MS);
  say("practice-status", "Clone sequence active.");
  render();
}

function drawLandmarks(
  result: NonNullable<Parameters<ConstructorParameters<typeof HandCamera>[1]>[0]>,
): void {
  for (const hand of [result.rightHandLandmarks, result.leftHandLandmarks]) {
    if (!hand) continue;
    ctx.fillStyle = "#67e8f9";
    for (const point of hand) {
      ctx.beginPath();
      ctx.arc((1 - point.x) * canvas.width, point.y * canvas.height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const camera = new HandCamera(
  video,
  (result) => {
    latest = result ? extractFeatures(result.rightHandLandmarks, result.leftHandLandmarks) : null;
    if (result) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (cloneEffect.isActive()) cloneEffect.draw(ctx, video, canvas.width, canvas.height);
      else drawLandmarks(result);
    }

    if (!latest) {
      const triggerState = practiceTrigger.observe(null, performance.now());
      clearScore();
      if (triggerState.released && model && !editingExamples) say("practice-status", "");
      return;
    }

    const now = performance.now();
    if (
      recording &&
      now >= recording.startsAt &&
      now < recording.endsAt &&
      now - recording.lastCapture >= COLLECTION.intervalMs
    ) {
      recording.frames.push([...latest]);
      recording.lastCapture = now;
      say("rec-badge", `${recording.frames.length}`);
    }

    if (now - lastUi < 150) return;
    lastUi = now;
    if (!model || editingExamples || busy === "training" || busy === "saving") return;

    try {
      const score = predictScore(model, latest);
      say("conf-label", `${Math.round(score * 100)}%`);
      progress("confidence").value = score * 100;
      if (cloneEffect.isActive()) return;

      const triggerState = practiceTrigger.observe(score, now);
      if (triggerState.triggered) {
        startCloneEffect(now);
      } else if (triggerState.phase === "holding") {
        say("practice-status", `Hold ${Math.round(triggerState.positiveProgress * 100)}%`);
      } else if (triggerState.phase === "latched" || triggerState.phase === "release-required") {
        say("practice-status", "Release to re-arm.");
      } else {
        say("practice-status", "");
      }
    } catch {
      clearScore();
      say("practice-status", "Prediction failed. Retrain the model.");
    }
  },
  (message, ready) => {
    cameraReady = ready;
    if (!ready) {
      latest = null;
      clearScore();
      if (recording) cancelClip();
    }
    const loading = /loading|starting|allow camera/i.test(message);
    const failed = /denied|could not|stopped|requires|does not provide|no usable|busy|failed/i.test(
      message,
    );
    say(
      "viewfinder-note",
      ready ? "" : cameraStarted ? (loading ? "Loading" : "Camera paused") : "Camera is off",
    );
    element("viewfinder-note").classList.toggle("loading", cameraStarted && loading);
    say("camera-status", failed ? message : "");
    if (failed) cameraStarted = false;
    render();
  },
);

function clearScore(): void {
  say("conf-label", "N/A");
  progress("confidence").value = 0;
}

function render(): void {
  const idle = busy === "idle";
  const interactionBlocked = staleExternal;

  for (const [label, countId, recId, removeId] of [
    ["clone_sign", "count-clone", "btn-rec-clone", "btn-remove-clone"],
    ["not_sign", "count-other", "btn-rec-other", "btn-remove-other"],
  ] as const) {
    const counts = classCounts(dataset.clips, label);
    say(countId, `${counts.clips} clips`);
    button(recId).disabled =
      !idle ||
      interactionBlocked ||
      !cameraReady ||
      dirty ||
      storageBlocked ||
      counts.clips >= COLLECTION.maxClipsPerClass;
    button(removeId).disabled =
      !idle || interactionBlocked || !counts.clips || dirty || storageBlocked;
  }

  button("btn-camera").disabled = interactionBlocked || cameraStarted || busy === "booting";
  button("btn-stop-camera").disabled = !cameraStarted;
  button("btn-train").disabled =
    !idle || interactionBlocked || dirty || storageBlocked || !readyToTrain(dataset.clips);
  button("btn-save-retry").hidden = !dirty;
  button("btn-save-retry").disabled = !idle || interactionBlocked;
  button("btn-cancel-clip").hidden = busy !== "recording";
  button("btn-cancel-train").hidden = busy !== "training";
  button("btn-edit-examples").disabled = !idle || interactionBlocked;
  button("effect-reset").hidden = !cloneEffect.isActive();

  element("training-controls").hidden = Boolean(model) && !editingExamples;
  element("trained-controls").hidden = !model || editingExamples;
  element("sync-warning").hidden = !staleExternal;
  const startOver = button("btn-start-over");
  const startOverHost = element(
    model && !editingExamples ? "trained-actions" : "training-primary-actions",
  );
  if (startOver.parentElement !== startOverHost) startOverHost.append(startOver);
  startOver.disabled = busy !== "idle" || staleExternal;
}

async function persistClips(): Promise<void> {
  busy = "saving";
  render();
  try {
    await saveDataset(dataset, persistedRevision);
    persistedRevision = dataset.revision;
    dirty = false;
    say("collection-status", "");
  } catch (error) {
    dirty = true;
    say("collection-status", `Save failed. ${storageFailureMessage(error)} Retry before training.`);
  } finally {
    busy = "idle";
    render();
  }
}

function cancelClip(): void {
  if (!recording) return;
  clearTimeout(recording.startTimer);
  clearTimeout(recording.timer);
  recording = null;
  element("rec-badge").hidden = true;
  busy = "idle";
  say("collection-status", "Recording cancelled.");
  render();
}

function beginClip(label: ClassLabel): void {
  if (
    busy !== "idle" ||
    !cameraReady ||
    dirty ||
    storageBlocked ||
    classCounts(dataset.clips, label).clips >= COLLECTION.maxClipsPerClass
  )
    return;

  busy = "recording";
  const startsAt = performance.now() + COLLECTION.leadInMs;
  const endsAt = startsAt + COLLECTION.clipMs;
  recording = {
    label,
    frames: [],
    lastCapture: -Infinity,
    startsAt,
    endsAt,
    startTimer: setTimeout(() => {
      if (recording) say("rec-badge", "REC");
    }, COLLECTION.leadInMs),
    timer: setTimeout(() => void finishClip(), COLLECTION.leadInMs + COLLECTION.clipMs),
  };
  say("rec-badge", "1");
  element("rec-badge").hidden = false;
  say("collection-status", "");
  render();
}

async function finishClip(): Promise<void> {
  if (!recording) return;
  const finished = recording;
  clearTimeout(finished.startTimer);
  recording = null;
  element("rec-badge").hidden = true;
  if (finished.frames.length < COLLECTION.minClipFrames) {
    busy = "idle";
    say("collection-status", `${finished.frames.length} usable frames. Record this clip again.`);
    render();
    return;
  }

  const clip: Clip = {
    id: crypto.randomUUID(),
    label: finished.label,
    frames: finished.frames,
    createdAt: Date.now(),
  };
  dataset = { revision: persistedRevision + 1, clips: [...dataset.clips, clip] };
  dirty = true;
  editingExamples = true;
  await persistClips();
}

async function removeLast(label: ClassLabel): Promise<void> {
  if (busy !== "idle" || dirty || storageBlocked) return;
  let index = -1;
  for (let i = dataset.clips.length - 1; i >= 0; i--) {
    if (dataset.clips[i].label === label) {
      index = i;
      break;
    }
  }
  if (index < 0) return;
  dataset = { revision: persistedRevision + 1, clips: dataset.clips.filter((_, i) => i !== index) };
  dirty = true;
  editingExamples = true;
  await persistClips();
}

button("btn-camera").addEventListener("click", () => {
  cameraStarted = true;
  say("viewfinder-note", "Loading");
  element("viewfinder-note").classList.add("loading");
  render();
  void camera.start();
});

button("btn-stop-camera").addEventListener("click", () => {
  cancelClip();
  cameraStarted = false;
  cameraReady = false;
  void camera.stop();
  say("camera-status", "");
  say("viewfinder-note", "Camera is off");
  element("viewfinder-note").classList.remove("loading");
  render();
});

button("btn-rec-clone").addEventListener("click", () => beginClip("clone_sign"));
button("btn-rec-other").addEventListener("click", () => beginClip("not_sign"));
button("btn-remove-clone").addEventListener("click", () => void removeLast("clone_sign"));
button("btn-remove-other").addEventListener("click", () => void removeLast("not_sign"));
button("btn-cancel-clip").addEventListener("click", cancelClip);
button("btn-save-retry").addEventListener("click", () => void persistClips());
button("btn-cancel-train").addEventListener("click", () => trainingAbort?.abort());
button("effect-reset").addEventListener("click", finishCloneEffect);
button("btn-edit-examples").addEventListener("click", () => {
  if (busy !== "idle" || staleExternal) return;
  if (cloneEffect.isActive()) finishCloneEffect();
  editingExamples = true;
  camera.setFrameProcessor(null);
  say("practice-status", "");
  render();
});

button("btn-train").addEventListener("click", async () => {
  if (busy !== "idle" || dirty || storageBlocked || !readyToTrain(dataset.clips)) return;
  busy = "training";
  trainingAbort = new AbortController();
  practiceTrigger.arm();
  clearScore();
  render();
  let candidate: tf.LayersModel | null = null;
  try {
    candidate = await trainClassifier(
      dataset.clips.filter((clip) => clip.label === "clone_sign").map((clip) => clip.frames),
      dataset.clips.filter((clip) => clip.label === "not_sign").map((clip) => clip.frames),
      (epoch) => {
        say("train-status", `Training ${epoch}/${TRAINING_EPOCHS}`);
        progress("training-progress").value = (epoch / TRAINING_EPOCHS) * 100;
      },
      trainingAbort.signal,
    );
    if (disposed) {
      candidate.dispose();
      candidate = null;
      return;
    }

    busy = "saving";
    render();
    say("train-status", "Saving model...");
    const published = await publishCandidate(candidate, dataset.revision);
    model?.dispose();
    model = candidate;
    candidate = null;
    record = published;
    editingExamples = false;
    practiceTrigger.arm();
    enableTestingRuntime();
    say("train-status", "");
    say("practice-status", "");
    render();
  } catch (error) {
    candidate?.dispose();
    const cancelled = error instanceof DOMException && error.name === "AbortError";
    say(
      "train-status",
      cancelled
        ? "Training cancelled."
        : `Training failed. ${error instanceof Error ? error.message : "Try again."}`,
    );
  } finally {
    busy = "idle";
    trainingAbort = null;
    if (disposed) {
      model?.dispose();
      model = null;
    }
    render();
  }
});

async function boot(): Promise<void> {
  void camera.prepare();
  void cloneEffect.prepareAssets().catch((error) => {
    say(
      "practice-status",
      `Effect assets failed to load. ${error instanceof Error ? error.message : ""}`,
    );
  });

  try {
    dataset = await loadDataset();
    persistedRevision = dataset.revision;
  } catch (error) {
    storageBlocked = true;
    say(
      "boot-status",
      error instanceof Error ? error.message : "Saved work could not open. Reload or start over.",
    );
  }

  try {
    record = await loadActiveRecord();
  } catch {
    storageBlocked = true;
    record = null;
    say("train-status", "Saved model data cannot be opened safely. Start over to clear it.");
  }

  if (record) {
    try {
      const restored = await tf.loadLayersModel(record.url);
      try {
        predictScore(
          restored,
          Array.from({ length: FEATURE_SIZE }, () => 0),
        );
      } catch (error) {
        restored.dispose();
        throw error;
      }
      model = restored;
      editingExamples = record.datasetRevision !== dataset.revision;
      practiceTrigger.arm();
      if (!editingExamples) enableTestingRuntime();
      else say("train-status", "Examples changed after this model. Train again.");
    } catch {
      record = null;
      model = null;
      editingExamples = true;
      say("train-status", "Saved model could not be restored. Train again.");
    }
  }

  busy = "idle";
  render();
}

async function markExternalChange(): Promise<void> {
  if (disposed || staleExternal) return;
  staleExternal = true;
  trainingAbort?.abort();
  if (recording) cancelClip();
  cameraStarted = false;
  cameraReady = false;
  await camera.stop();
  if (effectTimer) clearTimeout(effectTimer);
  effectTimer = null;
  cloneEffect.reset();
  model?.dispose();
  model = null;
  record = null;
  clearScore();
  say("sync-status", "Reload before continuing.");
  render();
}

async function checkStateFreshness(): Promise<void> {
  if (disposed || staleExternal || busy === "booting") return;
  try {
    const stamp = await loadStateStamp();
    if (stamp.datasetRevision !== persistedRevision || stamp.modelId !== (record?.id ?? null)) {
      await markExternalChange();
    }
  } catch {
    await markExternalChange();
  }
}

button("btn-start-over").addEventListener("click", () => {
  dialog("start-over-dialog").open = true;
});
button("btn-keep-work").addEventListener("click", () => {
  dialog("start-over-dialog").open = false;
});
button("btn-confirm-start-over").addEventListener("click", async () => {
  if (busy !== "idle") return;
  busy = "saving";
  dialog("start-over-dialog").open = false;
  render();
  trainingAbort?.abort();
  if (recording) cancelClip();
  cameraStarted = false;
  cameraReady = false;
  await camera.stop();
  try {
    const result = await clearAppState();
    dataset = result.dataset;
    persistedRevision = result.dataset.revision;
    dirty = false;
    storageBlocked = false;
    model?.dispose();
    model = null;
    record = null;
    if (result.cleanupFailures > 0) {
      say("boot-status", "Old model cleanup failed. Try Start over again.");
      busy = "idle";
      render();
      return;
    }
    location.reload();
  } catch (error) {
    say("boot-status", `Reset failed. ${storageFailureMessage(error)}`);
    busy = "idle";
    render();
  }
});
button("btn-reload-state").addEventListener("click", () => location.reload());

const unsubscribeStateChanges = subscribeAppStateChanges(() => void markExternalChange());
window.addEventListener("focus", () => void checkStateFreshness());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void checkStateFreshness();
});

window.addEventListener("pagehide", () => {
  disposed = true;
  unsubscribeStateChanges();
  cancelClip();
  trainingAbort?.abort();
  if (effectTimer) clearTimeout(effectTimer);
  effectTimer = null;
  camera.dispose();
  void cloneEffect.dispose();
  if (!trainingAbort) {
    model?.dispose();
    model = null;
  }
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});

render();
void boot();
