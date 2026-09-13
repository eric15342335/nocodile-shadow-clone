# Design system

The UI is intentionally compact and camera-first. It should feel like a small interactive tool rather than an admin dashboard.

## Typography

Source Sans Pro is the primary typeface. Use strong weight and scale for the page title, medium hierarchy for section headings, and tabular numerals for counts/scores.

## Color

- light neutral page/surface colors
- dark navy text
- orange for the clone-sign accent and score
- red only for destructive/reset semantics
- warning colors for recoverable state conflicts

Color tokens live in `src/design-system.css` rather than being duplicated across components.

## Layout

Desktop uses a two-column workspace with the camera as the larger column and the active task controls on the right. At narrow widths the workspace stacks vertically.

Keep spacing tight enough for laptop use without making controls difficult to target. Primary actions should remain obvious; destructive actions should be visually secondary.

## Interaction

- preserve visible keyboard focus
- support `prefers-reduced-motion`
- use explicit disabled states when an action is unavailable
- pair destructive actions with confirmation where data loss is involved
- keep action groups visually consistent in size and alignment
