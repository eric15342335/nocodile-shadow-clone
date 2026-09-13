import { expect, test } from "vitest";
import { extract, normalize } from "../src/legacy-features";
const hand = Array.from({ length: 21 }, (_, i) => ({ x: i * 0.01, y: i * 0.02, z: i * 0.001 }));
test("baseline manual models use 126 finite inputs, ordered right then left", () => {
  const vector = extract(hand, hand);
  expect(vector).toHaveLength(126);
  expect(vector.every(Number.isFinite)).toBe(true);
  expect(vector.slice(0, 63)).toEqual(normalize(hand));
  expect(vector.slice(63)).toEqual(normalize(hand));
});
test("documents the geometry loss in the original 126-value representation", () => {
  const apart = hand.map((p) => ({ ...p, x: p.x + 0.5 }));
  const crossed = extract(hand, hand);
  const separated = extract(hand, apart);
  separated.forEach((value, i) => expect(value).toBeCloseTo(crossed[i], 10));
});
