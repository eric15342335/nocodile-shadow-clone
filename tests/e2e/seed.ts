import { expect, type Page } from "@playwright/test";
import { COLLECTION } from "../../src/collection";
import { FEATURE_SIZE, FEATURE_VERSION } from "../../src/features";
import { STORAGE_NAME, STORAGE_VERSION } from "../../src/storage";

export const seededDataset = {
  revision: 1,
  clips: [
    ...Array.from({ length: COLLECTION.minClipsPerClass }, (_, clipIndex) => ({
      id: `positive-${clipIndex}`,
      label: "clone_sign" as const,
      frames: Array.from(
        { length: Math.ceil(COLLECTION.minFramesPerClass / COLLECTION.minClipsPerClass) },
        (_, frameIndex) =>
          Array.from({ length: FEATURE_SIZE }, (_, featureIndex) =>
            featureIndex < 126 ? 0.8 + frameIndex * 0.001 : 0.2 + clipIndex * 0.05,
          ),
      ),
      createdAt: clipIndex + 1,
    })),
    ...Array.from({ length: COLLECTION.minClipsPerClass }, (_, clipIndex) => ({
      id: `negative-${clipIndex}`,
      label: "not_sign" as const,
      frames: Array.from(
        { length: Math.ceil(COLLECTION.minFramesPerClass / COLLECTION.minClipsPerClass) },
        (_, frameIndex) =>
          Array.from({ length: FEATURE_SIZE }, (_, featureIndex) =>
            featureIndex < 126 ? -0.8 - frameIndex * 0.001 : 3.0 + clipIndex * 0.05,
          ),
      ),
      createdAt: clipIndex + 100,
    })),
  ],
};

export async function seedDataset(page: Page): Promise<void> {
  await page.evaluate(
    async ({ storageName, storageVersion, featureVersion, featureSize, dataset }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(storageName, storageVersion);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(
            { schemaVersion: storageVersion, featureVersion, featureSize, dataset },
            "dataset",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        };
      });
    },
    {
      storageName: STORAGE_NAME,
      storageVersion: STORAGE_VERSION,
      featureVersion: FEATURE_VERSION,
      featureSize: FEATURE_SIZE,
      dataset: seededDataset,
    },
  );
}

export async function trainSeededModel(page: Page): Promise<void> {
  await page.goto("/");
  await seedDataset(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Train model" })).toBeEnabled();
  await page.getByRole("button", { name: "Train model" }).click();
  await expect(page.locator("#trained-controls")).toBeVisible({ timeout: 45000 });
  await expect(page.locator("#training-controls")).toBeHidden();
}
