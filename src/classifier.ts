import * as tf from "@tensorflow/tfjs";
import { FEATURE_SIZE } from "./features";

export const TRAINING_EPOCHS = 50;
export const TRAINING_BATCH_SIZE = 16;
export const AUGMENT_ROTATION_DEGREES = 4;

export interface PreparedTrainingData {
  trainPositive: number[][];
  trainNegative: number[][];
}

function validateFeatures(features: number[]): void {
  if (features.length !== FEATURE_SIZE || !features.every(Number.isFinite)) {
    throw new Error(`Expected ${FEATURE_SIZE} finite gesture features.`);
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Training cancelled.", "AbortError");
}

/**
 * Rotate the image-plane x/y components coherently for both local hand shapes and
 * the inter-wrist vector. z and relative scale are intentionally unchanged.
 */
export function rotateGestureFeatures(features: number[], degrees: number): number[] {
  validateFeatures(features);
  const output = [...features];
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotatePair = (xIndex: number, yIndex: number) => {
    const x = features[xIndex];
    const y = features[yIndex];
    output[xIndex] = x * cosine - y * sine;
    output[yIndex] = x * sine + y * cosine;
  };

  for (const handOffset of [0, 63]) {
    for (let landmark = 0; landmark < 21; landmark += 1) {
      const base = handOffset + landmark * 3;
      rotatePair(base, base + 1);
    }
  }
  rotatePair(126, 127);
  return output;
}

function augmentTrainingFrames(frames: number[][]): number[][] {
  return frames.flatMap((features) => [
    [...features],
    rotateGestureFeatures(features, -AUGMENT_ROTATION_DEGREES),
    rotateGestureFeatures(features, AUGMENT_ROTATION_DEGREES),
  ]);
}

/** Use every accepted frame from every clip for training. */
export function prepareTrainingData(
  positiveClips: number[][][],
  negativeClips: number[][][],
): PreparedTrainingData {
  if (!positiveClips.length || !negativeClips.length) {
    throw new Error("Record examples of both poses before training.");
  }

  const prepare = (clips: number[][][]): number[][] => {
    const frames: number[][] = [];
    for (const clip of clips) {
      if (!clip.length) throw new Error("A training clip has no usable frames.");
      for (const features of clip) {
        validateFeatures(features);
        frames.push([...features]);
      }
    }
    return augmentTrainingFrames(frames);
  };

  return {
    trainPositive: prepare(positiveClips),
    trainNegative: prepare(negativeClips),
  };
}

/** The caller owns the successful model; this function never publishes it. */
export async function trainClassifier(
  positiveClips: number[][][],
  negativeClips: number[][][],
  onEpoch: (epoch: number) => void,
  signal?: AbortSignal,
): Promise<tf.LayersModel> {
  checkAbort(signal);
  const prepared = prepareTrainingData(positiveClips, negativeClips);
  const examples = [
    ...prepared.trainPositive.map((features) => ({ features, label: 1 })),
    ...prepared.trainNegative.map((features) => ({ features, label: 0 })),
  ];
  tf.util.shuffle(examples);
  await tf.ready();
  checkAbort(signal);

  const model = tf.sequential();
  let inputs: tf.Tensor2D | undefined;
  let labels: tf.Tensor2D | undefined;
  let callbackError: unknown;
  let callbackFailed = false;
  const cancel = () => {
    model.stopTraining = true;
  };
  try {
    model.add(tf.layers.dense({ units: 64, activation: "relu", inputShape: [FEATURE_SIZE] }));
    model.add(tf.layers.dropout({ rate: 0.3 }));
    model.add(tf.layers.dense({ units: 32, activation: "relu" }));
    model.add(tf.layers.dense({ units: 1, activation: "sigmoid" }));
    model.compile({ optimizer: "adam", loss: "binaryCrossentropy" });
    inputs = tf.tensor2d(
      examples.map(({ features }) => features),
      [examples.length, FEATURE_SIZE],
    );
    labels = tf.tensor2d(
      examples.map(({ label }) => [label]),
      [examples.length, 1],
    );
    signal?.addEventListener("abort", cancel, { once: true });
    await model.fit(inputs, labels, {
      epochs: TRAINING_EPOCHS,
      batchSize: TRAINING_BATCH_SIZE,
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          try {
            const loss = logs?.loss;
            if (typeof loss !== "number" || !Number.isFinite(loss)) {
              throw new Error(
                "Training produced an invalid result. Record new examples and retry.",
              );
            }
            onEpoch(epoch + 1);
          } catch (error) {
            callbackFailed = true;
            callbackError = error;
            model.stopTraining = true;
          }
        },
      },
    });
    checkAbort(signal);
    if (callbackFailed) throw callbackError;
    return model;
  } catch (error) {
    model.dispose();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    inputs?.dispose();
    labels?.dispose();
  }
}

/** Prediction allocates no persistent tensors. Missing hands must be rejected by the caller. */
export function assertCompatibleModel(model: tf.LayersModel): void {
  if (
    model.inputs.length !== 1 ||
    model.inputs[0].shape.length !== 2 ||
    model.inputs[0].shape[1] !== FEATURE_SIZE ||
    model.outputs.length !== 1 ||
    model.outputs[0].shape.length !== 2 ||
    model.outputs[0].shape[1] !== 1
  ) {
    throw new Error("The model is incompatible with the current gesture features.");
  }
}

export function predictScore(model: tf.LayersModel, features: number[]): number {
  validateFeatures(features);
  assertCompatibleModel(model);
  return tf.tidy(() => {
    const output = model.predict(tf.tensor2d([features], [1, FEATURE_SIZE]));
    if (Array.isArray(output) || output.size !== 1) {
      throw new Error("The model did not return a single clone-sign score.");
    }
    const score = output.dataSync()[0];
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error("The model returned an invalid clone-sign score.");
    }
    return score;
  });
}
