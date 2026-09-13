import type { Holistic as Constructor } from "@mediapipe/holistic";
import { loadScript } from "./load-script";
await loadScript("/vendor/holistic/holistic.js");
export const Holistic = (window as unknown as { Holistic: typeof Constructor }).Holistic;
