import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDB, openDB } from "idb";
import type { LayersModel } from "@tensorflow/tfjs";
import { FEATURE_SIZE, FEATURE_VERSION } from "../src/features";
import {
  loadDataset,
  saveDataset,
  loadActiveRecord,
  publishCandidate,
  publishModel,
  clearAppState,
  loadStateStamp,
  STORAGE_NAME,
  type Dataset,
  type ModelRecord,
} from "../src/storage";

const dataset: Dataset = {
  revision: 1,
  clips: [
    {
      id: "clip-1",
      label: "clone_sign",
      frames: [Array.from({ length: FEATURE_SIZE }, () => 0.2)],
      createdAt: 1,
    },
  ],
};
function record(revision = 1): ModelRecord {
  const id = crypto.randomUUID();
  return {
    id,
    url: `indexeddb://nocodile-model-${id}`,
    datasetRevision: revision,
    featureVersion: FEATURE_VERSION,
    featureSize: FEATURE_SIZE,
    createdAt: 1,
  };
}
async function corrupt(key: string, value: unknown) {
  const db = await openDB(STORAGE_NAME, 1);
  await db.put("state", value, key);
  db.close();
}
beforeEach(async () => {
  await deleteDB(STORAGE_NAME);
});
describe("browser-local storage boundary", () => {
  it("starts empty and restores complete clips after closing and reopening", async () => {
    expect(await loadDataset()).toEqual({ revision: 0, clips: [] });
    expect(await loadActiveRecord()).toBeNull();
    await saveDataset(dataset, 0);
    expect(await loadDataset()).toEqual(dataset);
  });
  it("rejects malformed, non-finite and incompatible persisted data without overwriting it", async () => {
    await saveDataset(dataset, 0);
    const wrapper = {
      schemaVersion: 1,
      featureVersion: FEATURE_VERSION,
      featureSize: FEATURE_SIZE,
      dataset,
    };
    await corrupt("dataset", { ...wrapper, featureVersion: "old" });
    await expect(loadDataset()).rejects.toThrow("incompatible");
    await expect(saveDataset({ ...dataset, revision: 2 }, 1)).rejects.toThrow("incompatible");
    await corrupt("dataset", {
      ...wrapper,
      dataset: { ...dataset, clips: [{ ...dataset.clips[0], frames: [[NaN]] }] },
    });
    await expect(loadDataset()).rejects.toThrow("corrupt");
  });
  it("rejects stale saves without losing the last complete dataset", async () => {
    await saveDataset(dataset, 0);
    await expect(saveDataset(dataset, 0)).rejects.toThrow("another tab");
    expect(await loadDataset()).toEqual(dataset);
  });
  it("start-over clears app state, keeps revision monotonic, and removes only Nocodile models", async () => {
    await saveDataset(dataset, 0);
    const old = record();
    await publishModel(old);
    const removeModel = vi.fn(async () => ({}));
    const result = await clearAppState({
      listModels: async () => ({
        [old.url]: {},
        "indexeddb://nocodile-model-orphan": {},
        "indexeddb://other-app-model": {},
      }),
      removeModel,
    });
    expect(result.dataset).toEqual({ revision: 2, clips: [] });
    expect(result.cleanupFailures).toBe(0);
    expect(await loadDataset()).toEqual(result.dataset);
    expect(await loadActiveRecord()).toBeNull();
    expect(await loadStateStamp()).toEqual({ datasetRevision: 2, modelId: null });
    expect(removeModel).toHaveBeenCalledTimes(2);
    expect(removeModel).not.toHaveBeenCalledWith("indexeddb://other-app-model");
    await expect(saveDataset({ ...dataset, revision: 2 }, 1)).rejects.toThrow("another tab");
  });

  it("reports model cleanup failures after state is safely reset", async () => {
    await saveDataset(dataset, 0);
    const result = await clearAppState({
      listModels: async () => ({ "indexeddb://nocodile-model-orphan": {} }),
      removeModel: async () => {
        throw new Error("cleanup failed");
      },
    });
    expect(result.cleanupFailures).toBe(1);
    expect(await loadDataset()).toEqual({ revision: 2, clips: [] });
    expect(await loadActiveRecord()).toBeNull();
  });
  it("only points at a new candidate after save succeeds", async () => {
    await saveDataset(dataset, 0);
    const old = record();
    await publishModel(old);
    const save: LayersModel["save"] = vi.fn(async () => {
      expect(await loadActiveRecord()).toEqual(old);
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" as const } };
    });
    const next = await publishCandidate({ save }, 1, { verifySaved: async () => {} });
    expect(save).toHaveBeenCalledWith(next.url);
    expect(next.url).not.toBe(old.url);
    expect(await loadActiveRecord()).toEqual(next);
  });
  it("preserves the previous active model when artifact save fails", async () => {
    await saveDataset(dataset, 0);
    const old = record();
    await publishModel(old);
    const save: LayersModel["save"] = vi.fn(async () => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    await expect(publishCandidate({ save }, 1)).rejects.toThrow("Storage full");
    expect(await loadActiveRecord()).toEqual(old);
  });
  it("does not publish a candidate that cannot be reloaded and verified", async () => {
    await saveDataset(dataset, 0);
    const old = record();
    await publishModel(old);
    const save: LayersModel["save"] = vi.fn(async () => ({
      modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" as const },
    }));
    const verifySaved = vi.fn(async () => {
      throw new Error("Saved candidate is unreadable");
    });
    const removeSaved = vi.fn(async () => {});
    await expect(publishCandidate({ save }, 1, { verifySaved, removeSaved })).rejects.toThrow(
      "unreadable",
    );
    expect(verifySaved).toHaveBeenCalledOnce();
    expect(removeSaved).toHaveBeenCalledOnce();
    expect(await loadActiveRecord()).toEqual(old);
  });

  it("preserves the previous active model when publication is rejected after saving", async () => {
    await saveDataset(dataset, 0);
    const old = record();
    await publishModel(old);
    const save: LayersModel["save"] = vi.fn(async () => {
      await saveDataset({ ...dataset, revision: 2 }, 1);
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" as const } };
    });
    await expect(publishCandidate({ save }, 1, { verifySaved: async () => {} })).rejects.toThrow(
      "Samples changed",
    );
    expect(await loadActiveRecord()).toEqual(old);
  });
  it("keeps samples and active model when an IndexedDB write fails", async () => {
    await saveDataset(dataset, 0);
    const old = record();
    await publishModel(old);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    try {
      await expect(saveDataset({ ...dataset, revision: 2 }, 1)).rejects.toThrow("Storage full");
      const save: LayersModel["save"] = vi.fn(async () => ({
        modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" as const },
      }));
      await expect(publishCandidate({ save }, 1, { verifySaved: async () => {} })).rejects.toThrow(
        "Storage full",
      );
    } finally {
      put.mockRestore();
    }
    expect(await loadDataset()).toEqual(dataset);
    expect(await loadActiveRecord()).toEqual(old);
  });
  it("rejects model metadata pointing outside this app or using incompatible features", async () => {
    await loadActiveRecord();
    await corrupt("activeModel", {
      schemaVersion: 1,
      record: { ...record(), url: "https://example.org/model.json" },
    });
    await expect(loadActiveRecord()).rejects.toThrow("incompatible");
    await corrupt("activeModel", { schemaVersion: 1, record: { ...record(), featureSize: 126 } });
    await expect(loadActiveRecord()).rejects.toThrow("incompatible");
  });
});
