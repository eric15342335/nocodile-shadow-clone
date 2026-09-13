import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { FEATURE_SIZE, FEATURE_VERSION } from "../../src/features";
import { STORAGE_NAME, STORAGE_VERSION } from "../../src/storage";
import { seedDataset, trainSeededModel } from "./seed";

test("saved work restores automatically and keyboard reset flow remains usable", async ({
  page,
}) => {
  await page.goto("/");
  await seedDataset(page);
  await page.reload();

  await expect(page.getByRole("button", { name: "Train model" })).toBeEnabled();
  const startOver = page.getByRole("button", { name: "Start over" });
  await startOver.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#start-over-dialog")).toHaveAttribute("open", "");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#start-over-dialog")).not.toHaveAttribute("open", "");
});

test("start over clears Nocodile work but preserves unrelated browser storage", async ({
  page,
}) => {
  await page.goto("/");
  await seedDataset(page);
  await page.evaluate(async () => {
    localStorage.setItem("unrelated-classroom-setting", "keep-me");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("unrelated-classroom-db", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("state", "readwrite");
        tx.objectStore("state").put("keep-me", "value");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();

  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Clear work" }).click();
  await expect(page.locator("#count-clone")).toHaveText("0 clips");
  await expect(page.locator("#count-other")).toHaveText("0 clips");

  const unrelated = await page.evaluate(async () => {
    const local = localStorage.getItem("unrelated-classroom-setting");
    const indexed = await new Promise<string | undefined>((resolve, reject) => {
      const request = indexedDB.open("unrelated-classroom-db", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction("state", "readonly").objectStore("state").get("value");
        get.onsuccess = () => {
          db.close();
          resolve(get.result as string | undefined);
        };
        get.onerror = () => reject(get.error);
      };
    });
    return { local, indexed };
  });
  expect(unrelated).toEqual({ local: "keep-me", indexed: "keep-me" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("corrupt saved samples expose the in-app start-over recovery path", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ({ storageName, storageVersion, featureVersion, featureSize }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(storageName, storageVersion);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("state"))
            request.result.createObjectStore("state");
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(
            {
              schemaVersion: storageVersion,
              featureVersion,
              featureSize,
              dataset: {
                revision: 7,
                clips: [{ id: "broken", label: "clone_sign", frames: [[NaN]], createdAt: 1 }],
              },
            },
            "dataset",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    {
      storageName: STORAGE_NAME,
      storageVersion: STORAGE_VERSION,
      featureVersion: FEATURE_VERSION,
      featureSize: FEATURE_SIZE,
    },
  );
  await page.reload();

  await expect(page.locator("#boot-status")).toContainText(/corrupt or incompatible/i);
  await expect(page.getByRole("button", { name: "Train model" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start over" })).toBeEnabled();
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Clear work" }).click();
});

test("corrupt saved-model metadata blocks training and can be cleared in-app", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ({ storageName, storageVersion }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(storageName, storageVersion);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("state"))
            request.result.createObjectStore("state");
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("state", "readwrite");
          const id = "00000000-0000-4000-8000-000000000002";
          tx.objectStore("state").put(
            {
              schemaVersion: storageVersion,
              record: {
                id,
                url: `indexeddb://nocodile-model-${id}`,
                datasetRevision: 0,
                featureVersion: "obsolete-feature-format",
                featureSize: 126,
                createdAt: 1,
              },
            },
            "activeModel",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { storageName: STORAGE_NAME, storageVersion: STORAGE_VERSION },
  );
  await page.reload();

  await expect(page.locator("#train-status")).toContainText(/cannot be opened safely/i);
  await expect(page.getByRole("button", { name: "Train model" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start over" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Clear work" }).click();
});

test("camera permission denial gives an actionable retry state", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("denied for test", "NotAllowedError");
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start camera" }).click();
  await expect(page.locator("#camera-status")).toContainText("Camera access was denied");
  await expect(page.getByRole("button", { name: "Start camera" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("reset in one tab invalidates a loaded model in another tab", async ({ page, context }) => {
  test.setTimeout(90000);
  await trainSeededModel(page);

  const sibling = await context.newPage();
  await sibling.goto("/");
  await expect(sibling.locator("#trained-controls")).toBeVisible();
  await expect(sibling.getByRole("button", { name: "Start camera" })).toBeEnabled();

  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Clear work" }).click();

  await expect(sibling.locator("#sync-warning")).toBeVisible({ timeout: 15000 });
  await expect(sibling.locator("#sync-status")).toContainText("Reload before continuing");
  await expect(sibling.getByRole("button", { name: "Start camera" })).toBeDisabled();
  expect((await new AxeBuilder({ page: sibling }).analyze()).violations).toEqual([]);
});

test("trained mode can return to example editing without opening another camera", async ({
  page,
}) => {
  await trainSeededModel(page);
  await expect(page.locator("#trained-controls")).toBeVisible();
  await expect(page.locator("#training-controls")).toBeHidden();
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(1);

  await page.getByRole("button", { name: "Edit examples" }).click();
  await expect(page.locator("#training-controls")).toBeVisible();
  await expect(page.locator("#trained-controls")).toBeHidden();
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
