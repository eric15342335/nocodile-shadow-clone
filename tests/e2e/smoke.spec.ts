import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readdir } from "node:fs/promises";
import { STORAGE_NAME, STORAGE_VERSION } from "../../src/storage";
import { trainSeededModel } from "./seed";

test("fresh browser shows one camera and the collection controls", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Train your clone sign/i })).toBeVisible();
  await expect(page.locator(".viewfinder")).toHaveCount(1);
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator("#training-controls")).toBeVisible();
  await expect(page.locator("#trained-controls")).toBeHidden();
  await expect(page.locator("#model-upload")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  for (const file of await readdir("public/assets", { recursive: true })) {
    if (!file.endsWith(".png")) continue;
    const response = await request.get(`/assets/${file}`);
    expect(response.status(), file).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
  }
  expect(errors).toEqual([]);
});

test("training switches the same panel from collection controls to live score", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await trainSeededModel(page);
  await expect(page.locator("#training-controls")).toBeHidden();
  await expect(page.locator("#trained-controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start camera" })).toBeEnabled();

  await page.reload();
  await expect(page.locator("#trained-controls")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const isolated = await browser.newContext();
  try {
    const isolatedPage = await isolated.newPage();
    await isolatedPage.goto("http://127.0.0.1:4173/");
    await expect(isolatedPage.locator("#training-controls")).toBeVisible();
    await expect(isolatedPage.locator("#trained-controls")).toBeHidden();
  } finally {
    await isolated.close();
  }
  expect(errors).toEqual([]);
});

test("legacy trainer route redirects to the consolidated workflow", async ({ page }) => {
  await page.goto("/trainer.html");
  await expect(page).toHaveURL(/\/#collect$/);
  await expect(page.getByRole("heading", { name: /Train your clone sign/i })).toBeVisible();
  await expect(page.locator(".viewfinder")).toHaveCount(1);
});

test("incompatible saved-model metadata keeps the in-page retraining path", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ({ storageName, storageVersion }) => {
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
          const id = "00000000-0000-4000-8000-000000000001";
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
  await expect(page.locator("#training-controls")).toBeVisible();
  await expect(page.locator("#trained-controls")).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
