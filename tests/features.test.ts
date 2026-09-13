import { expect, test } from "vitest";
import { extractFeatures, FEATURE_SIZE, FEATURE_VERSION } from "../src/features";
import { extract as legacyExtract } from "../src/legacy-features";
import {
  crossed,
  separated,
  almostCorrect,
  rotatedPositive,
  missingHand,
  degenerate,
  nonFinite,
  transformHand,
} from "./fixtures/landmarks";

function distance(a: number[], b: number[]) {
  return Math.hypot(...a.map((v, i) => v - b[i]));
}

test("versioned features preserve shapes and distinguish inter-hand placement", () => {
  const positive = extractFeatures(crossed.right, crossed.left)!;
  const negative = extractFeatures(separated.right, separated.left)!;
  expect(FEATURE_VERSION).toBe("two-hand-local-relative-v1");
  expect(positive).toHaveLength(FEATURE_SIZE);
  expect(positive.every(Number.isFinite)).toBe(true);
  expect(distance(positive.slice(0, 126), negative.slice(0, 126))).toBeLessThan(1e-12);
  expect(distance(positive, negative)).toBeGreaterThan(3);
  expect(
    distance(
      legacyExtract(crossed.right, crossed.left),
      legacyExtract(separated.right, separated.left),
    ),
  ).toBeLessThan(1e-12);
  expect(
    distance(positive, extractFeatures(almostCorrect.right, almostCorrect.left)!),
  ).toBeGreaterThan(0.5);
});

test("shared-coordinate candidate retains geometry but couples local shape to hand size", () => {
  // Alternative: all xy centered at the right wrist and divided by mean scale;
  // z remains local to its own wrist because there is no shared hand-depth origin.
  const shared = (right: typeof crossed.right, left: typeof crossed.left) => {
    const scale =
      (Math.hypot(right[9].x - right[0].x, right[9].y - right[0].y, right[9].z - right[0].z) +
        Math.hypot(left[9].x - left[0].x, left[9].y - left[0].y, left[9].z - left[0].z)) /
      2;
    return [right, left].flatMap((hand) =>
      hand.flatMap((p) => [
        (p.x - right[0].x) / scale,
        (p.y - right[0].y) / scale,
        (p.z - hand[0].z) / scale,
      ]),
    );
  };
  expect(
    distance(shared(crossed.right, crossed.left), shared(separated.right, separated.left)),
  ).toBeGreaterThan(3);
  const wrist = crossed.left[0];
  const largerLeft = crossed.left.map((p) => ({
    x: wrist.x + (p.x - wrist.x) * 1.5,
    y: wrist.y + (p.y - wrist.y) * 1.5,
    z: wrist.z + (p.z - wrist.z) * 1.5,
  }));
  const base = extractFeatures(crossed.right, crossed.left)!;
  const changed = extractFeatures(crossed.right, largerLeft)!;
  expect(distance(base.slice(0, 126), changed.slice(0, 126))).toBeLessThan(1e-12);
  expect(changed[128] - base[128]).toBeCloseTo(Math.log(1.5), 12);
  expect(
    distance(
      shared(crossed.right, crossed.left).slice(0, 63),
      shared(crossed.right, largerLeft).slice(0, 63),
    ),
  ).toBeGreaterThan(0.5);
});

test("common translation and uniform scale are invariant; rotation remains learnable", () => {
  const base = extractFeatures(crossed.right, crossed.left)!;
  const moved = extractFeatures(
    transformHand(crossed.right, 0, 1.7, 0.1, -0.2),
    transformHand(crossed.left, 0, 1.7, 0.1, -0.2),
  )!;
  expect(distance(base, moved)).toBeLessThan(1e-12);
  const rotated = extractFeatures(rotatedPositive.right, rotatedPositive.left)!;
  expect(rotated.every(Number.isFinite)).toBe(true);
  expect(distance(base, rotated)).toBeGreaterThan(0.1);
  expect(Math.hypot(...base.slice(126, 128))).toBeCloseTo(
    Math.hypot(...rotated.slice(126, 128)),
    12,
  );
  expect(rotated[128]).toBeCloseTo(base[128], 12);
});

test("hand z origins cannot masquerade as relative two-hand depth", () => {
  const shiftedZ = crossed.left.map((p) => ({ ...p, z: p.z + 0.3 }));
  expect(
    distance(
      extractFeatures(crossed.right, crossed.left)!,
      extractFeatures(crossed.right, shiftedZ)!,
    ),
  ).toBeLessThan(1e-12);
});

test("missing, malformed, degenerate and non-finite landmarks are unavailable", () => {
  for (const pair of [missingHand, degenerate, nonFinite]) {
    expect(extractFeatures(pair.right, pair.left)).toBeNull();
  }
  expect(extractFeatures()).toBeNull();
  const sparse: typeof crossed.right = [];
  sparse.length = 21;
  expect(extractFeatures(sparse, crossed.left)).toBeNull();
  expect(extractFeatures(crossed.right.slice(1), crossed.left)).toBeNull();
  expect(extractFeatures([...crossed.right, crossed.right[0]], crossed.left)).toBeNull();
  expect(extractFeatures(crossed.right, transformHand(crossed.left, 0, 1e-9))).toBeNull();
  for (const value of [Infinity, -Infinity, NaN]) {
    for (const axis of ["x", "y", "z"] as const) {
      expect(
        extractFeatures(
          crossed.right.map((p, i) => (i === 3 ? { ...p, [axis]: value } : p)),
          crossed.left,
        ),
      ).toBeNull();
    }
  }
});
