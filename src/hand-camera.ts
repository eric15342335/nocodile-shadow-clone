import type { Holistic, Results } from "@mediapipe/holistic";
import { publicUrl } from "./public-url";
import { cameraFailureMessage, cameraSupportMessage } from "./recovery";

// Keep camera frames imperative. No component/store receives raw video frames.
export class HandCamera {
  private detector: Holistic | null = null;
  private modulePromise: Promise<typeof import("@mediapipe/holistic")> | null = null;
  private stream: MediaStream | null = null;
  private frame = 0;
  private pending: Promise<void> | null = null;
  private generation = 0;
  private active = false;
  private starting = false;
  private stopped: Promise<void> = Promise.resolve();
  private firstResult = false;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  private frameProcessor: ((video: HTMLVideoElement) => Promise<void>) | null = null;
  constructor(
    private video: HTMLVideoElement,
    private result: (result: Results | null) => void,
    private status: (message: string, ready: boolean) => void,
  ) {
    document.addEventListener("visibilitychange", this.visibility);
  }
  setFrameProcessor(processor: ((video: HTMLVideoElement) => Promise<void>) | null): void {
    this.frameProcessor = processor;
  }
  prepare(): Promise<void> {
    if (!this.modulePromise) this.modulePromise = import("@mediapipe/holistic");
    return this.modulePromise.then(() => undefined);
  }
  private visibility = () => {
    if (!this.active) return;
    if (this.stream)
      this.stream.getVideoTracks().forEach((track) => {
        track.enabled = !document.hidden;
      });
    if (document.hidden) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.result(null);
      this.status("Camera paused while this tab is hidden.", false);
    } else {
      this.status("Camera resumed. Show both hands.", this.firstResult);
      this.schedule();
    }
  };
  async start(): Promise<void> {
    if (this.active || this.starting) return;
    const support = cameraSupportMessage();
    if (support) {
      this.status(support, false);
      return;
    }
    this.starting = true;
    const generation = ++this.generation;
    try {
      await this.stopped;
      // MediaPipe can finish close() slightly before Chromium releases the video
      // capture pipeline. Yield briefly before requesting the same device again.
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      this.status("Camera starting...", false);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      this.status("Camera ready. Loading hand tracking...", false);
      if (!this.modulePromise) void this.prepare();
      const modulePromise = this.modulePromise;
      if (!modulePromise) throw new Error("Hand tracking could not initialize.");
      const { Holistic } = await modulePromise;
      if (generation !== this.generation) return;
      this.detector = new Holistic({ locateFile: (file) => publicUrl(`vendor/holistic/${file}`) });
      this.detector.setOptions({ modelComplexity: 1, smoothLandmarks: true });
      this.detector.onResults((result) => {
        if (!this.active || document.hidden || generation !== this.generation) return;
        if (!this.firstResult) {
          this.firstResult = true;
          if (this.slowTimer) clearTimeout(this.slowTimer);
          this.slowTimer = null;
          this.status("Camera running. Show both hands.", true);
        }
        this.result(result);
      });
      this.active = true;
      this.slowTimer = setTimeout(() => {
        if (this.active && !this.firstResult) {
          this.status(
            "Hand tracking is taking longer than expected. Close other heavy tabs or try a faster device if it does not recover.",
            false,
          );
        }
      }, 15000);
      this.schedule();
    } catch (error) {
      if (generation === this.generation) {
        await this.stop();
        this.status(cameraFailureMessage(error), false);
      }
    } finally {
      this.starting = false;
    }
  }
  private schedule(): void {
    if (!this.active || this.pending || this.frame || document.hidden) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const detector = this.detector;
      if (!this.active || !detector) return;
      this.pending = (async () => {
        await this.frameProcessor?.(this.video);
        await detector.send({ image: this.video });
      })();
      void this.pending.then(
        () => {
          this.pending = null;
          this.schedule();
        },
        () => {
          this.pending = null;
          void this.stop();
          this.status("Hand tracking stopped. Stop and start the camera to try again.", false);
        },
      );
    });
  }
  stop(): Promise<void> {
    this.generation++;
    this.active = false;
    this.firstResult = false;
    if (this.slowTimer) clearTimeout(this.slowTimer);
    this.slowTimer = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.result(null);
    const detector = this.detector;
    this.detector = null;
    const pending = this.pending;
    this.stopped = (async () => {
      await pending?.catch(() => {});
      await detector?.close().catch(() => {});
    })();
    return this.stopped;
  }
  dispose(): void {
    document.removeEventListener("visibilitychange", this.visibility);
    void this.stop();
  }
}
