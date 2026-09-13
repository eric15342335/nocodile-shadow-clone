import { expect, test } from "vitest";
import { GestureTrigger, TRIGGER_CONFIG } from "../src/trigger";

const high = 1;
const low = 0.2;

function triggerAt500(trigger: GestureTrigger) {
  trigger.observe(high, 0);
  trigger.observe(high, 200);
  trigger.observe(high, 400);
  return trigger.observe(high, 500);
}

test("triggers only after sustained fresh positive evidence", () => {
  const trigger = new GestureTrigger();
  expect(trigger.observe(high, 0).triggered).toBe(false);
  expect(trigger.observe(high, 200).triggered).toBe(false);
  expect(trigger.observe(high, 400).triggered).toBe(false);
  const result = trigger.observe(high, 500);
  expect(result.triggered).toBe(true);
  expect(result.phase).toBe("latched");
});

test("a long prediction gap clears positive hold evidence", () => {
  const trigger = new GestureTrigger();
  trigger.observe(high, 0);
  trigger.observe(high, 200);
  expect(trigger.observe(high, 500).triggered).toBe(false); // 300ms gap > maxPositiveGapMs.
  expect(trigger.observe(high, 700).triggered).toBe(false);
  expect(trigger.observe(high, 1000).triggered).toBe(false); // another long gap restarts again.
});

test("missing hands can release but can never trigger", () => {
  const trigger = new GestureTrigger();
  expect(triggerAt500(trigger).triggered).toBe(true);

  expect(trigger.observe(null, 2100).released).toBe(false);
  const released = trigger.observe(null, 2100 + TRIGGER_CONFIG.releaseMs);
  expect(released.released).toBe(true);
  expect(released.phase).toBe("armed");

  expect(trigger.observe(null, 4000).triggered).toBe(false);
  expect(trigger.observe(null, 5000).phase).toBe("armed");
});

test("reset requires a low or absent release and prevents hold-through retrigger", () => {
  const trigger = new GestureTrigger();
  expect(triggerAt500(trigger).triggered).toBe(true);

  expect(trigger.requireRelease(700).phase).toBe("release-required");
  expect(trigger.observe(high, 2500).phase).toBe("release-required");
  expect(trigger.observe(high, 3200).triggered).toBe(false);

  trigger.observe(low, 3300);
  const released = trigger.observe(low, 3300 + TRIGGER_CONFIG.releaseMs);
  expect(released.phase).toBe("armed");
  expect(released.released).toBe(true);

  trigger.observe(high, 4000);
  trigger.observe(high, 4200);
  trigger.observe(high, 4400);
  expect(trigger.observe(high, 4500).triggered).toBe(true);
});

test("low score clears an in-progress positive hold", () => {
  const trigger = new GestureTrigger();
  trigger.observe(high, 0);
  trigger.observe(high, 200);
  expect(trigger.observe(low, 300).phase).toBe("armed");
  trigger.observe(high, 400);
  trigger.observe(high, 600);
  trigger.observe(high, 800);
  expect(trigger.observe(high, 900).triggered).toBe(true);
});
