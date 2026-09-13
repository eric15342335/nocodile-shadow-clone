import { test, expect } from "@playwright/test";
import { trainSeededModel } from "./seed";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--enable-unsafe-swiftshader",
    ],
  },
});

async function expectSharedCameraReady(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: "Stop camera" })).toBeEnabled({ timeout: 45000 });
  await expect(page.locator("#viewfinder-note")).toHaveText("", { timeout: 45000 });
  await expect
    .poll(
      () =>
        page.locator("#trainer-canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).width),
      {
        timeout: 45000,
      },
    )
    .toBe(640);
}

test("shared camera supports collection stop and restart", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  await page.getByRole("button", { name: "Start camera" }).click();
  await expectSharedCameraReady(page);
  await expect(page.getByRole("button", { name: "Record" }).first()).toBeEnabled();

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#viewfinder-note")).toContainText("Camera paused");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#viewfinder-note")).toHaveText("", { timeout: 45000 });

  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect(page.locator("#viewfinder-note")).toHaveText("Camera is off");
  await page.getByRole("button", { name: "Start camera" }).click();
  await expectSharedCameraReady(page);

  await page.getByRole("button", { name: "Record" }).first().click();
  await expect(page.locator("#rec-badge")).toBeVisible();
  await expect(page.locator("#collection-status")).toContainText("0 usable frames", {
    timeout: 7000,
  });
  await expect(page.locator("#count-clone")).toHaveText("0 clips");
  expect(errors).toEqual([]);
});

test("trained model uses the same camera for live score and clone runtime", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await trainSeededModel(page);
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator("#trained-controls")).toBeVisible();
  await page.getByRole("button", { name: "Start camera" }).click();
  await expectSharedCameraReady(page);
  await expect(page.locator("#conf-label")).toBeVisible();

  await page.getByRole("button", { name: "Stop camera" }).click();
  await expect(page.locator("#viewfinder-note")).toHaveText("Camera is off");
  expect(errors).toEqual([]);
});
