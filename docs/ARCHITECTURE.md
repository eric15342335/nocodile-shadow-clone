# Architecture

Nocodile is a static browser application. Webcam capture, feature extraction, model training, persistence, inference, and rendering all happen client-side.

## Data flow

```text
webcam
  -> MediaPipe Holistic
  -> two-hand feature vector
  -> recorded clips
  -> TensorFlow.js classifier
  -> browser IndexedDB
  -> live confidence
  -> gesture trigger
  -> Selfie Segmentation + clone renderer
```

The camera stream is shared across collection, prediction, segmentation, and rendering. The app does not create a second webcam session when switching modes.

## Gesture representation

Each prediction uses 129 values:

- 63 normalized coordinates for the right hand
- 63 normalized coordinates for the left hand
- 2 relative wrist-position values
- 1 relative palm-scale value

Per-hand coordinates are wrist-centered and normalized by wrist-to-middle-MCP distance. The extra relative values preserve the relationship between the two hands, which the original 126-value representation lost.

## Training

Training uses all accepted frames from all recorded clips. Each frame is expanded into three examples: original, -4 degree rotation, and +4 degree rotation.

The classifier is a small binary TensorFlow.js network: 64-unit ReLU, dropout, 32-unit ReLU, and a sigmoid output. It trains for 50 epochs with Adam and binary cross entropy.

## Persistence

Gesture clips are stored in IndexedDB. Trained TensorFlow.js model artifacts are also stored in browser IndexedDB. A model record carries the dataset revision it was trained against, so stale models can be detected after examples change.

This makes deployment effectively stateless per user: a static host can serve many students without shared model files.

## Triggering

Live prediction uses a strict 0.999 positive threshold plus hold/debounce logic. A completed effect requires a low-confidence or absent-hand release before it can trigger again.

The finite effect lifetime is 4.6 seconds.

## Rendering

The clone choreography uses the original 16 positions/scales/delays and smoke sprites. Selfie Segmentation extracts the current person image each frame.

The visual stack is intentionally:

1. webcam background
2. clones and smoke
3. segmented real person

That foreground pass keeps the real person in front of the clones, matching the original reference effect.

## Runtime dependencies

The production runtime uses pinned npm packages for TensorFlow.js, MediaPipe Holistic, Selfie Segmentation, IndexedDB helpers, schema validation, fonts, and Web Awesome components.

MediaPipe's legacy browser files are copied into `public/vendor/` during dev/build so the shipped app does not depend on a third-party CDN at runtime.
