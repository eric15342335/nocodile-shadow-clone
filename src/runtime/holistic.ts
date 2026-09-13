import type { Holistic as Constructor } from "@mediapipe/holistic";
import { publicUrl } from "../public-url";
import { loadScript } from "./load-script";
await loadScript(publicUrl("vendor/holistic/holistic.js"));
export const Holistic = (window as unknown as { Holistic: typeof Constructor }).Holistic;
