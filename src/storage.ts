import { openDB } from "idb";
import { z } from "zod";
import * as tf from "@tensorflow/tfjs";
import type { LayersModel } from "@tensorflow/tfjs";
import { FEATURE_SIZE, FEATURE_VERSION } from "./features";
import { assertCompatibleModel, predictScore } from "./classifier";
import { announceAppStateChange } from "./state-sync";

export const STORAGE_NAME = "nocodile-browser-ml";
export const STORAGE_VERSION = 1;
const frameSchema = z.array(z.number().finite()).length(FEATURE_SIZE);
const clipSchema = z.object({
  id: z.string().min(1),
  label: z.enum(["clone_sign", "not_sign"]),
  frames: z.array(frameSchema).min(1),
  createdAt: z.number().int().nonnegative(),
});
const datasetSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    clips: z.array(clipSchema),
  })
  .refine(
    (value) => new Set(value.clips.map((clip) => clip.id)).size === value.clips.length,
    "Clip IDs must be unique",
  );
const storedDatasetSchema = z.object({
  schemaVersion: z.literal(STORAGE_VERSION),
  featureVersion: z.literal(FEATURE_VERSION),
  featureSize: z.literal(FEATURE_SIZE),
  dataset: datasetSchema,
});
const modelSchema = z
  .object({
    id: z.string().uuid(),
    url: z.string(),
    datasetRevision: z.number().int().nonnegative(),
    featureVersion: z.literal(FEATURE_VERSION),
    featureSize: z.literal(FEATURE_SIZE),
    createdAt: z.number().int().nonnegative(),
  })
  .refine(
    (value) => value.url === `indexeddb://nocodile-model-${value.id}`,
    "Invalid model storage URL",
  );
const storedModelSchema = z.object({
  schemaVersion: z.literal(STORAGE_VERSION),
  record: modelSchema,
});
export type Clip = z.infer<typeof clipSchema>;
export type Dataset = z.infer<typeof datasetSchema>;
export type ModelRecord = z.infer<typeof modelSchema>;
export interface StateStamp {
  datasetRevision: number;
  modelId: string | null;
}
export interface ResetResult {
  dataset: Dataset;
  cleanupFailures: number;
}

function parseDataset(value: unknown): Dataset {
  if (value === undefined) return { revision: 0, clips: [] };
  const parsed = storedDatasetSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Saved samples are corrupt or incompatible with this version. Your saved data was left untouched; use the compatible app version or clear this site's storage to start again.",
    );
  return parsed.data.dataset;
}
function parseModel(value: unknown): ModelRecord | null {
  if (value === undefined) return null;
  const parsed = storedModelSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Saved model metadata is corrupt or incompatible. Retrain with this version; the previous saved model was left untouched.",
    );
  return parsed.data.record;
}
async function openStorage() {
  return openDB(STORAGE_NAME, STORAGE_VERSION, {
    upgrade(db) {
      db.createObjectStore("state");
    },
  });
}
export async function loadDataset(): Promise<Dataset> {
  const db = await openStorage();
  try {
    return parseDataset(await db.get("state", "dataset"));
  } finally {
    db.close();
  }
}
export async function loadActiveRecord(): Promise<ModelRecord | null> {
  const db = await openStorage();
  try {
    return parseModel(await db.get("state", "activeModel"));
  } finally {
    db.close();
  }
}
export async function saveDataset(dataset: Dataset, expectedRevision: number): Promise<void> {
  const checked = datasetSchema.parse(dataset);
  if (checked.revision !== expectedRevision + 1)
    throw new Error(
      "Samples must advance exactly one revision. Reload saved work before retrying.",
    );
  const db = await openStorage();
  try {
    const tx = db.transaction("state", "readwrite");
    // Attach rejection handler immediately: an aborted transaction must not become unhandled.
    const completion = tx.done.catch((error: unknown) => error);
    try {
      const previous = parseDataset(await tx.store.get("dataset"));
      if (previous.revision !== expectedRevision)
        throw new Error(
          "Saved samples changed in another tab. Reload saved work before collecting more.",
        );
      await tx.store.put(
        {
          schemaVersion: STORAGE_VERSION,
          featureVersion: FEATURE_VERSION,
          featureSize: FEATURE_SIZE,
          dataset: checked,
        },
        "dataset",
      );
      await tx.done;
      announceAppStateChange("dataset");
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already completed or aborted. */
      }
      await completion;
      throw error;
    }
  } finally {
    db.close();
  }
}

/** Call only after the complete candidate has successfully saved to its unique TFJS URL. */
export async function publishModel(record: ModelRecord): Promise<void> {
  const checked = modelSchema.parse(record);
  const db = await openStorage();
  try {
    const tx = db.transaction("state", "readwrite");
    const completion = tx.done.catch((error: unknown) => error);
    try {
      const dataset = parseDataset(await tx.store.get("dataset"));
      if (dataset.revision !== checked.datasetRevision)
        throw new Error(
          "Samples changed while training. Save current samples and train again; the previous model remains active.",
        );
      await tx.store.put({ schemaVersion: STORAGE_VERSION, record: checked }, "activeModel");
      await tx.done;
      announceAppStateChange("model");
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already completed or aborted. */
      }
      await completion;
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function loadStateStamp(): Promise<StateStamp> {
  const db = await openStorage();
  try {
    const tx = db.transaction("state", "readonly");
    const [datasetValue, modelValue] = await Promise.all([
      tx.store.get("dataset"),
      tx.store.get("activeModel"),
    ]);
    await tx.done;
    return {
      datasetRevision: parseDataset(datasetValue).revision,
      modelId: parseModel(modelValue)?.id ?? null,
    };
  } finally {
    db.close();
  }
}

export interface ResetPersistenceHooks {
  listModels?: () => Promise<Record<string, unknown>>;
  removeModel?: (url: string) => Promise<unknown>;
}

function resetRevision(value: unknown): number {
  try {
    return parseDataset(value).revision + 1;
  } catch {
    // Corrupt/incompatible state still needs an in-app recovery path. A timestamp-sized
    // revision is far beyond normal classroom revisions, so stale tabs cannot match it.
    return Date.now();
  }
}

/**
 * Clears only Nocodile-owned browser state. The empty dataset keeps a monotonically
 * increasing revision so a stale tab cannot resurrect pre-reset samples with a later save.
 */
export async function clearAppState(hooks: ResetPersistenceHooks = {}): Promise<ResetResult> {
  const db = await openStorage();
  let empty: Dataset | null = null;
  try {
    const tx = db.transaction("state", "readwrite");
    const completion = tx.done.catch((error: unknown) => error);
    try {
      const currentValue = await tx.store.get("dataset");
      empty = { revision: resetRevision(currentValue), clips: [] };
      await tx.store.clear();
      await tx.store.put(
        {
          schemaVersion: STORAGE_VERSION,
          featureVersion: FEATURE_VERSION,
          featureSize: FEATURE_SIZE,
          dataset: empty,
        },
        "dataset",
      );
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already completed or aborted. */
      }
      await completion;
      throw error;
    }
  } finally {
    db.close();
  }

  if (!empty) throw new Error("App reset did not create a new empty dataset.");

  let cleanupFailures = 0;
  try {
    const listed = hooks.listModels ? await hooks.listModels() : await tf.io.listModels();
    const remove = hooks.removeModel ?? ((url: string) => tf.io.removeModel(url));
    for (const url of Object.keys(listed)) {
      if (!url.startsWith("indexeddb://nocodile-model-")) continue;
      try {
        await remove(url);
      } catch {
        cleanupFailures += 1;
      }
    }
  } catch {
    cleanupFailures += 1;
  }

  announceAppStateChange("reset");
  return { dataset: empty, cleanupFailures };
}

export interface CandidatePersistenceHooks {
  verifySaved?: (url: string) => Promise<void>;
  removeSaved?: (url: string) => Promise<void>;
}

async function verifySavedModel(url: string): Promise<void> {
  const restored = await tf.loadLayersModel(url);
  try {
    assertCompatibleModel(restored);
    predictScore(
      restored,
      Array.from({ length: FEATURE_SIZE }, () => 0),
    );
  } finally {
    restored.dispose();
  }
}

async function removeSavedModel(url: string): Promise<void> {
  try {
    await tf.io.removeModel(url);
  } catch {
    // Cleanup is best-effort. The active pointer remains the source of truth.
  }
}

/**
 * Caller retains ownership of the in-memory model. The active pointer is published only
 * after the uniquely named TFJS artifact can be loaded and validated. A failed candidate
 * never replaces the previous active model.
 */
export async function publishCandidate(
  model: Pick<LayersModel, "save">,
  datasetRevision: number,
  hooks: CandidatePersistenceHooks = {},
): Promise<ModelRecord> {
  const previous = await loadActiveRecord();
  const verify = hooks.verifySaved ?? verifySavedModel;
  const remove = hooks.removeSaved ?? removeSavedModel;
  const id = crypto.randomUUID();
  const record: ModelRecord = {
    id,
    url: `indexeddb://nocodile-model-${id}`,
    datasetRevision,
    featureVersion: FEATURE_VERSION,
    featureSize: FEATURE_SIZE,
    createdAt: Date.now(),
  };

  await model.save(record.url);
  try {
    await verify(record.url);
    await publishModel(record);
  } catch (error) {
    await remove(record.url);
    throw error;
  }

  if (previous && previous.url !== record.url) await remove(previous.url);
  return record;
}
