import type { NormalizedLandmarkList } from "@mediapipe/holistic";
// Legacy 126-input format retained for regression tests against the original geometry.
export function normalize(lm: NormalizedLandmarkList) {
  const w = lm[0],
    mcp = lm[9];
  const scale = Math.sqrt((mcp.x - w.x) ** 2 + (mcp.y - w.y) ** 2 + (mcp.z - w.z) ** 2) || 1;
  const out = [];
  for (let i = 0; i < 21; i++) {
    out.push((lm[i].x - w.x) / scale);
    out.push((lm[i].y - w.y) / scale);
    out.push((lm[i].z - w.z) / scale);
  }
  return out;
}

export function extract(right: NormalizedLandmarkList, left: NormalizedLandmarkList) {
  return [...normalize(right), ...normalize(left)];
}
