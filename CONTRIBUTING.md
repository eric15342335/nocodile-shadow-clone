# Contributing

Use Bun for dependency management and scripts.

```sh
bun install --frozen-lockfile
bun run dev
```

Before opening a change, run the checks relevant to what you touched. For broad or structural changes, use:

```sh
bun run check
```

Keep webcam/model data client-side unless a product requirement explicitly calls for server storage. Preserve the single-camera architecture and the foreground-person clone rendering stack.

Generated dependencies, build output, MediaPipe vendor files, Playwright artifacts, tunnel logs, and local downloads should not be committed.

See `AGENTS.md` for implementation invariants and `docs/ARCHITECTURE.md` for the technical overview.
