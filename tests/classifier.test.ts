import * as tf from "@tensorflow/tfjs";
import { beforeAll, expect, test } from "vitest";
import {
  AUGMENT_ROTATION_DEGREES,
  predictScore,
  prepareTrainingData,
  rotateGestureFeatures,
  trainClassifier,
  TRAINING_EPOCHS,
} from "../src/classifier";
import { FEATURE_SIZE } from "../src/features";

beforeAll(async () => {
  await tf.setBackend("cpu");
  await tf.ready();
});

const sample = (value: number) => Array.from({ length: FEATURE_SIZE }, () => value);
const clips = (...values: number[]) => values.map((value) => [sample(value), sample(value * 0.99)]);

function constantModel(size = FEATURE_SIZE, activation: "sigmoid" | "linear" = "sigmoid") {
  return tf.sequential({
    layers: [
      tf.layers.dense({
        inputShape: [size],
        units: 1,
        activation,
        kernelInitializer: "zeros",
        biasInitializer: "zeros",
      }),
    ],
  });
}

test("prediction returns a finite score without retaining input or output tensors", () => {
  const model = constantModel();
  try {
    const tensors = tf.memory().numTensors;
    for (let i = 0; i < 20; i++) expect(predictScore(model, sample(0))).toBe(0.5);
    expect(tf.memory().numTensors).toBe(tensors);
    expect(() => predictScore(model, [0])).toThrow("finite gesture features");
    expect(() => predictScore(model, sample(Number.NaN))).toThrow("finite gesture features");
    expect(tf.memory().numTensors).toBe(tensors);
  } finally {
    model.dispose();
  }
});

test("prediction rejects incompatible models and invalid scores without leaking", () => {
  const wrong = constantModel(FEATURE_SIZE - 1);
  const invalid = constantModel(FEATURE_SIZE, "linear");
  const weights = [tf.zeros([FEATURE_SIZE, 1]), tf.tensor1d([2])];
  invalid.setWeights(weights);
  tf.dispose(weights);
  try {
    const tensors = tf.memory().numTensors;
    expect(() => predictScore(wrong, sample(0))).toThrow("incompatible");
    expect(() => predictScore(invalid, sample(0))).toThrow("invalid clone-sign score");
    expect(tf.memory().numTensors).toBe(tensors);
  } finally {
    wrong.dispose();
    invalid.dispose();
  }
});

test("all accepted frames are used for training and augmented", () => {
  const positive = clips(1, 2, 3);
  const negative = clips(-1, -2, -3);
  const original = structuredClone({ positive, negative });
  const prepared = prepareTrainingData(positive, negative);

  expect(prepared.trainPositive).toHaveLength(18);
  expect(prepared.trainNegative).toHaveLength(18);
  expect(prepared.trainPositive).toContainEqual(positive[2][0]);
  expect(prepared.trainNegative).toContainEqual(negative[2][0]);
  expect({ positive, negative }).toEqual(original);
});

test("rotation augmentation changes only image-plane geometry and is reversible", () => {
  const features = Array.from({ length: FEATURE_SIZE }, (_, index) => index / 100);
  const rotated = rotateGestureFeatures(features, AUGMENT_ROTATION_DEGREES);
  const restored = rotateGestureFeatures(rotated, -AUGMENT_ROTATION_DEGREES);

  for (const handOffset of [0, 63]) {
    for (let landmark = 0; landmark < 21; landmark += 1) {
      const base = handOffset + landmark * 3;
      expect(rotated[base + 2]).toBe(features[base + 2]);
    }
  }
  expect(rotated[128]).toBe(features[128]);
  expect(rotated[126]).not.toBe(features[126]);
  expect(rotated[127]).not.toBe(features[127]);
  restored.forEach((value, index) => expect(value).toBeCloseTo(features[index], 10));
});

test("training validates clip structure before allocating a model", async () => {
  const tensors = tf.memory().numTensors;
  await expect(trainClassifier([], clips(-1, -2), () => {})).rejects.toThrow("both poses");
  await expect(trainClassifier([[sample(Infinity)]], clips(-1, -2), () => {})).rejects.toThrow(
    "finite gesture features",
  );
  expect(tf.memory().numTensors).toBe(tensors);
});

test("actual training returns a usable candidate without mutating clips", async () => {
  const tensors = tf.memory().numTensors;
  const positive = clips(1, 0.95, 0.9);
  const negative = clips(-1, -0.95, -0.9);
  const original = structuredClone({ positive, negative });
  const epochs: number[] = [];
  const model = await trainClassifier(positive, negative, (epoch) => epochs.push(epoch));
  try {
    expect(epochs).toHaveLength(TRAINING_EPOCHS);
    expect(epochs.at(-1)).toBe(TRAINING_EPOCHS);
    expect(predictScore(model, sample(1))).toBeGreaterThan(predictScore(model, sample(-1)));
    expect({ positive, negative }).toEqual(original);
  } finally {
    model.dispose();
  }
  expect(tf.memory().numTensors).toBe(tensors);
});

test("cancelled and failed training release candidates and optimizer tensors", async () => {
  const tensors = tf.memory().numTensors;
  const positive = clips(1, 0.9);
  const negative = clips(-1, -0.9);
  const controller = new AbortController();
  await expect(
    trainClassifier(positive, negative, () => controller.abort(), controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(tf.memory().numTensors).toBe(tensors);

  await expect(
    trainClassifier(positive, negative, () => {
      throw new Error("Progress callback failed");
    }),
  ).rejects.toThrow("Progress callback failed");
  expect(tf.memory().numTensors).toBe(tensors);
});
