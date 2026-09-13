import type { Landmark } from "../../src/features";

export interface HandPair {
  right?: Landmark[];
  left?: Landmark[];
}

// Synthetic geometry only: not captured people or evidence of detector quality.
// Two extended fingers, other fingers folded, in MediaPipe landmark order.
const local: Landmark[] = [
  { x: 0, y: 0, z: 0 },
  { x: -0.025, y: -0.025, z: -0.002 },
  { x: -0.045, y: -0.04, z: -0.005 },
  { x: -0.03, y: -0.065, z: -0.009 },
  { x: -0.01, y: -0.07, z: -0.012 },
  { x: -0.025, y: -0.075, z: -0.003 },
  { x: -0.025, y: -0.12, z: -0.006 },
  { x: -0.025, y: -0.155, z: -0.008 },
  { x: -0.025, y: -0.18, z: -0.01 },
  { x: 0, y: -0.08, z: -0.004 },
  { x: 0, y: -0.13, z: -0.007 },
  { x: 0, y: -0.17, z: -0.009 },
  { x: 0, y: -0.195, z: -0.012 },
  { x: 0.023, y: -0.072, z: -0.003 },
  { x: 0.025, y: -0.1, z: -0.014 },
  { x: 0.02, y: -0.065, z: -0.025 },
  { x: 0.015, y: -0.05, z: -0.03 },
  { x: 0.043, y: -0.057, z: -0.001 },
  { x: 0.047, y: -0.08, z: -0.01 },
  { x: 0.04, y: -0.05, z: -0.02 },
  { x: 0.032, y: -0.04, z: -0.025 },
];

export function transformHand(hand: Landmark[], angle = 0, scale = 1, dx = 0, dy = 0): Landmark[] {
  return hand.map(({ x, y, z }) => ({
    x: scale * (x * Math.cos(angle) - y * Math.sin(angle)) + dx,
    y: scale * (x * Math.sin(angle) + y * Math.cos(angle)) + dy,
    z: scale * z,
  }));
}
export const crossed = {
  right: transformHand(local, 0, 1, 0.5, 0.62),
  left: transformHand(local, Math.PI / 2, 1, 0.38, 0.5),
};
export const separated = {
  right: crossed.right,
  left: transformHand(crossed.left, 0, 1, -0.25, 0),
};
export const almostCorrect = {
  right: crossed.right,
  left: crossed.left.map((point, i) =>
    i === 8 || i === 12 ? { ...point, y: point.y + 0.055, z: point.z - 0.025 } : { ...point },
  ),
};
export const rotatedPositive = {
  right: transformHand(crossed.right, Math.PI / 12),
  left: transformHand(crossed.left, Math.PI / 12),
};
export const missingHand: HandPair = { right: crossed.right };
export const degenerate: HandPair = {
  right: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
  left: crossed.left,
};
export const nonFinite: HandPair = {
  right: crossed.right.map((p, i) => (i === 8 ? { ...p, x: NaN } : { ...p })),
  left: crossed.left,
};
