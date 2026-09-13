# Nocodile

Nocodile is a browser-only gesture trainer that lets you teach a small TensorFlow.js model your clone sign, test it live, and trigger a Naruto-inspired shadow-clone effect from the same webcam view.

## Features

- Record positive and negative gesture examples from your webcam.
- Train the classifier entirely in the browser.
- Persist examples and the trained model in browser storage.
- See a live clone-sign confidence score after training.
- Trigger the smoke-and-shadow-clone effect without uploading user data to a server.
- Reuse the original clone choreography and visual assets while keeping the real person in the foreground.

## Run locally

Requires Bun. Node.js 24 is the currently tested runtime.

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://127.0.0.1:5173/`. Webcam access requires localhost or HTTPS.

## Workflow

1. Start the camera.
2. Record examples of the clone sign and examples that are not the clone sign.
3. Train the model.
4. Show the sign to test the live score and trigger the effect.

Recording uses a one-second lead-in followed by five seconds of capture. Saved examples and the active model restore automatically on the same browser origin.

## Useful commands

```sh
bun run dev        # development server
bun run build      # typecheck + production build
bun run test       # unit tests
bun run test:e2e   # Playwright browser tests
bun run check      # full formatter/lint/type/test/build/e2e gate
```

## Project layout

- `src/` — gesture features, training, persistence, camera runtime, trigger logic, and clone effect
- `public/assets/` — smoke and hand-sign artwork
- `tests/` — unit and browser tests
- `docs/ARCHITECTURE.md` — technical architecture and ML pipeline
- `docs/DESIGN_SYSTEM.md` — UI conventions
- `docs/PROVENANCE.md` — upstream/reference attribution and licensing notes
- `AGENTS.md` — detailed maintenance notes and implementation invariants

## Privacy

Camera frames, gesture examples, training, and inference stay in the browser during normal use. The app has no per-user backend storage.

## Attribution

The shadow-clone concept and visual assets are adapted from Nasha Wanich's original `naruto-shadow-clone-jutsu` project. See `docs/PROVENANCE.md` before redistributing the assets.
