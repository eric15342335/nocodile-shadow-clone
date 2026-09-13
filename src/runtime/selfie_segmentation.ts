import type { SelfieSegmentation as Constructor } from "@mediapipe/selfie_segmentation";
import { publicUrl } from "../public-url";
import { loadScript } from "./load-script";
await loadScript(publicUrl("vendor/selfie_segmentation/selfie_segmentation.js"));
export const SelfieSegmentation = (window as unknown as { SelfieSegmentation: typeof Constructor })
  .SelfieSegmentation;
