export const COLLECTION = {
  intervalMs: 125,
  leadInMs: 1000,
  clipMs: 5000,
  minClipFrames: 8,
  minClipsPerClass: 3,
  minFramesPerClass: 48,
  maxClipsPerClass: 12,
} as const;
export type ClassLabel = "clone_sign" | "not_sign";
export function classCounts(clips: { label: ClassLabel; frames: number[][] }[], label: ClassLabel) {
  const selected = clips.filter((clip) => clip.label === label);
  return {
    clips: selected.length,
    frames: selected.reduce((sum, clip) => sum + clip.frames.length, 0),
  };
}
export function readyToTrain(clips: { label: ClassLabel; frames: number[][] }[]): boolean {
  return (["clone_sign", "not_sign"] as const).every((label) => {
    const counts = classCounts(clips, label);
    return (
      counts.clips >= COLLECTION.minClipsPerClass && counts.frames >= COLLECTION.minFramesPerClass
    );
  });
}
