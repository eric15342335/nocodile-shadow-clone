import { expect, test } from "vitest";
import { COLLECTION, classCounts, readyToTrain, type ClassLabel } from "../src/collection";

const frames = (count: number) => Array.from({ length: count }, () => [0]);
const clip = (id: string, label: ClassLabel, frameCount: number) => ({
  id,
  label,
  frames: frames(frameCount),
  createdAt: 1,
});

test("class counts report clips and accepted frames independently", () => {
  const clips = [
    clip("a", "clone_sign", 12),
    clip("b", "clone_sign", 20),
    clip("c", "not_sign", 7),
  ];
  expect(classCounts(clips, "clone_sign")).toEqual({ clips: 2, frames: 32 });
  expect(classCounts(clips, "not_sign")).toEqual({ clips: 1, frames: 7 });
});

test("training readiness requires both clip diversity and accepted-frame minimums", () => {
  const enough = (["clone_sign", "not_sign"] as const).flatMap((label) =>
    Array.from({ length: COLLECTION.minClipsPerClass }, (_, index) =>
      clip(
        `${label}-${index}`,
        label,
        Math.ceil(COLLECTION.minFramesPerClass / COLLECTION.minClipsPerClass),
      ),
    ),
  );
  expect(readyToTrain(enough)).toBe(true);
  expect(readyToTrain(enough.slice(1))).toBe(false);

  const tooFewFrames = enough.map((item) => ({ ...item, frames: frames(1) }));
  expect(readyToTrain(tooFewFrames)).toBe(false);
});
