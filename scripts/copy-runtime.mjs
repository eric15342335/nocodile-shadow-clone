import { cp, mkdir, readdir } from "node:fs/promises";

// Pinned npm packages own these generated, same-origin MediaPipe resources.
for (const name of ["holistic", "selfie_segmentation"]) {
  const source = `node_modules/@mediapipe/${name}`;
  const target = `public/vendor/${name}`;
  await mkdir(target, { recursive: true });
  for (const file of await readdir(source)) {
    if (/\.(js|wasm|data|tflite|binarypb)$/.test(file)) {
      await cp(`${source}/${file}`, `${target}/${file}`);
    }
  }
}
