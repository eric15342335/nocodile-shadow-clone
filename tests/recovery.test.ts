import { describe, expect, it } from "vitest";
import { cameraFailureMessage, storageFailureMessage } from "../src/recovery";

describe("actionable recovery messages", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["NotFoundError", "No usable camera"],
    ["NotReadableError", "busy"],
    ["OverconstrainedError", "requested video mode"],
  ])("maps camera %s to actionable guidance", (name, fragment) => {
    expect(cameraFailureMessage({ name })).toContain(fragment);
  });

  it("distinguishes full or blocked storage", () => {
    expect(storageFailureMessage({ name: "QuotaExceededError" })).toContain("storage is full");
    expect(storageFailureMessage({ name: "SecurityError" })).toContain("blocked or unavailable");
  });
});
