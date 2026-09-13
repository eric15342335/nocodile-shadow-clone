export interface Landmark {
  x: number;
  y: number;
  z: number;
}

// Ordered right-hand local xyz (63), left-hand local xyz (63),
// left-minus-right wrist xy / mean palm scale (2), log(left/right scale) (1).
export const FEATURE_VERSION = "two-hand-local-relative-v1";
export const FEATURE_SIZE = 129;
const MIN_SCALE = 1e-6;

function validHand(hand: Landmark[] | undefined): hand is Landmark[] {
  if (!Array.isArray(hand) || hand.length !== 21) return false;
  for (const point of hand) {
    if (
      point == null ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    )
      return false;
  }
  return true;
}

function palmScale(hand: Landmark[]): number {
  const wrist = hand[0];
  const middle = hand[9];
  return Math.hypot(middle.x - wrist.x, middle.y - wrist.y, middle.z - wrist.z);
}

function localShape(hand: Landmark[], scale: number): number[] {
  const wrist = hand[0];
  return hand.flatMap((point) => [
    (point.x - wrist.x) / scale,
    (point.y - wrist.y) / scale,
    (point.z - wrist.z) / scale,
  ]);
}

/** Missing/malformed hands are unavailable, never a zero-vector prediction.
 * Coordinates retain image-plane orientation; rotated signs need training examples.
 * Hand z is wrist-relative in MediaPipe, so inter-hand z is deliberately omitted.
 */
export function extractFeatures(right?: Landmark[], left?: Landmark[]): number[] | null {
  if (!validHand(right) || !validHand(left)) return null;
  const rightScale = palmScale(right);
  const leftScale = palmScale(left);
  if (
    !Number.isFinite(rightScale) ||
    !Number.isFinite(leftScale) ||
    rightScale < MIN_SCALE ||
    leftScale < MIN_SCALE
  )
    return null;
  const meanScale = rightScale / 2 + leftScale / 2;
  const features = [
    ...localShape(right, rightScale),
    ...localShape(left, leftScale),
    (left[0].x - right[0].x) / meanScale,
    (left[0].y - right[0].y) / meanScale,
    Math.log(leftScale) - Math.log(rightScale),
  ];
  return features.every(Number.isFinite) ? features : null;
}
