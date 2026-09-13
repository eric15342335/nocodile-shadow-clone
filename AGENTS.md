# Nocodile maintainer notes

This file contains durable implementation context for coding agents and maintainers. Keep public usage instructions in `README.md`; keep architecture details in `docs/ARCHITECTURE.md` when they are useful to human contributors too.

## Product intent

Nocodile should provide one seamless browser flow:

`collect examples -> train -> test confidence -> trigger shadow clones`

The normal path must not require downloading or re-uploading a model. User data should remain browser-local so many students can use the same static deployment independently.

## Repository layout

The application lives at the repository root.

- `index.html` is the main app.
- `trainer.html` is a compatibility redirect to the main app.
- `src/trainer.ts` coordinates collection, training, persistence, testing, and effect state.
- `src/hand-camera.ts` owns the single webcam stream and shared video/canvas loop.
- `src/features.ts` defines the current model input schema.
- `src/classifier.ts` defines training and prediction.
- `src/storage.ts` owns IndexedDB/model persistence.
- `src/trigger.ts` owns gesture debounce/release state.
- `src/clone-effect.ts` owns segmentation, smoke, clone placement, and effect rendering.
- `src/runtime/` contains the small ESM adapters for legacy MediaPipe browser globals.
- `public/assets/` contains the clone/smoke artwork.
- `tests/` contains Vitest and Playwright coverage.

## Runtime architecture

Keep the application browser-only unless a concrete product requirement demands a backend.

There is one shared webcam stream, one video element, and one canvas. Training, live prediction, MediaPipe Holistic, Selfie Segmentation, and the clone effect must reuse that camera path rather than opening independent camera streams.

MediaPipe runtime files are copied from pinned npm packages into `public/vendor/` by `scripts/copy-runtime.mjs`. That directory is generated and must not be committed.

## Gesture features

The current feature schema is `two-hand-local-relative-v1`, 129 values total:

- right hand: 21 wrist-centered, palm-scale-normalized xyz landmarks = 63
- left hand: same = 63
- left-minus-right wrist x/y divided by mean palm scale = 2
- log left/right palm-scale ratio = 1

Both hands must be present and valid. Do not silently substitute missing hands with zero vectors.

If the feature schema changes, update its version, storage compatibility/recovery behavior, tests, and model compatibility checks together.

## Collection and training invariants

Current recording behavior is one click, one-second lead-in, then five seconds of capture.

The dataset is clip-based. Use all accepted frames for training; there is no validation holdout in the current product. Training applies the existing conservative in-plane augmentation to each frame: original, -4 degrees, +4 degrees.

The neural network is intentionally small:

- Dense 64 ReLU
- Dropout 0.3
- Dense 32 ReLU
- Dense 1 sigmoid
- Adam + binary cross entropy
- 50 epochs, batch size 16, shuffle enabled

Do not add a backend training service or a heavier model without a measured reason.

## Trigger behavior

The current positive threshold is `0.999` to match the original effect's strict trigger behavior.

The trigger also requires sustained evidence rather than a single prediction:

- 500 ms positive hold
- at least 3 positive predictions
- max 250 ms gap between positive predictions
- release at or below 0.6 for 600 ms
- 2 second cooldown

After the finite effect ends, a release is required before another trigger.

## Clone-effect invariants

The 16 clone positions, scales, delays, and smoke timing are inherited from the original reference implementation. Preserve those values unless a visual change is explicitly requested.

Rendering order matters. The intended stack is:

1. live webcam background
2. clones and smoke
3. the segmented real person in the foreground

The real person must appear in front of the clones. The effect currently has a finite 4.6 second lifetime and then resets so it can be used again after release.

The `state-1.png` and `state-2.png` overlay assets come from the original project. Mirroring should remain consistent with the selfie view.

## Persistence and recovery

Examples are stored in IndexedDB. TensorFlow.js model artifacts are persisted in browser IndexedDB and linked to the dataset revision they were trained from.

Existing saved work restores automatically. There is no `Saved work / Continue` gate. `Start over` is the explicit destructive reset path and must keep its confirmation dialog.

Cross-tab state changes should fail safely rather than allowing two tabs to overwrite each other silently.

## UI behavior

Desktop uses a camera-first two-column layout: camera on the left, examples/training or score controls on the right. Narrow screens stack to one column.

Keep the workflow compact enough that primary controls are visible without unnecessary scrolling on typical laptop screens.

Use Web Awesome components for interactive controls already represented by that library. Preserve keyboard focus states and reduced-motion support.

Destructive actions should look destructive and should not visually compete with the primary workflow action.

## Commands

```sh
bun install --frozen-lockfile
bun run dev
bun run format
bun run lint
bun run typecheck
bun run test
bun run build
bun run test:e2e
bun run check
```

For changes to pure logic, run focused unit tests while editing. For structural changes, camera/canvas behavior, persistence, or user-flow changes, run the production build and relevant Playwright tests before committing.

## Public-repo hygiene

Do not commit:

- `node_modules/`
- `dist/`
- generated `public/vendor/`
- browser profiles or Playwright output
- tunnel logs/download bundles
- secrets or tunnel credentials
- internal prompt/checkpoint/session notes

Keep README prose concise. Put durable implementation detail here or in `docs/` rather than turning the README into a build diary.

## Provenance

The original visual/effect reference is Nasha Wanich's `naruto-shadow-clone-jutsu` repository:

https://github.com/nasha-wanich/naruto-shadow-clone-jutsu

The original project did not expose an explicit license in the reviewed snapshot. Do not invent licensing terms. See `docs/PROVENANCE.md` for the assets and history that matter before public redistribution.
