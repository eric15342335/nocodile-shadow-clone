import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const forbiddenDisplayPunctuation = /[\u2190-\u21ff\u2013\u2014\u2026]/u;

test("single-camera workflow stays readable and removes duplicate supporting copy", async ({
  page,
}) => {
  await page.goto("/");
  const bodyFont = await page.locator("body").evaluate((node) => getComputedStyle(node).fontFamily);
  expect(bodyFont).toContain("Source Sans Pro");
  expect(await page.evaluate(() => document.fonts.check('16px "Source Sans Pro"'))).toBe(true);

  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(forbiddenDisplayPunctuation);
  expect(visibleText).not.toContain("BROWSER ONLY");
  expect(visibleText).not.toContain("dataset revision");
  await expect(page.locator(".viewfinder")).toHaveCount(1);
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator(".sample-class").first()).toHaveCSS("border-left-width", "1px");

  const tooSmall = await page
    .locator(".counts, .status-line, .metric-line, .sync-warning p")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const style = getComputedStyle(node);
          return style.display !== "none" && Number.parseFloat(style.fontSize) < 14;
        })
        .map((node) => ({ text: node.textContent, size: getComputedStyle(node).fontSize })),
    );
  expect(tooSmall).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
