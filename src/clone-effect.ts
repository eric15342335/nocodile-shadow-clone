import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";
import { publicUrl } from "./public-url";

const SMOKE_FOLDERS = ["smoke_1", "smoke_2", "smoke_3"] as const;
const SMOKE_FRAME_COUNT = 5;
const SMOKE_DURATION = 600;
export const CLONE_EFFECT_DURATION_MS = 4600;

const CLONES = [
  { x: -100, y: 100, scale: 0.9, delay: 1000 },
  { x: 120, y: 100, scale: 0.85, delay: 1150 },
  { x: -180, y: 140, scale: 0.8, delay: 1300 },
  { x: -140, y: 140, scale: 0.45, delay: 1320 },
  { x: 180, y: 160, scale: 0.7, delay: 1450 },
  { x: 140, y: 160, scale: 0.4, delay: 1470 },
  { x: -250, y: 140, scale: 0.7, delay: 1600 },
  { x: -220, y: 140, scale: 0.35, delay: 1620 },
  { x: 260, y: 160, scale: 0.65, delay: 1750 },
  { x: -100, y: 150, scale: 0.6, delay: 2500 },
  { x: 100, y: 150, scale: 0.6, delay: 2650 },
  { x: -120, y: 70, scale: 0.55, delay: 2800 },
  { x: 100, y: 70, scale: 0.5, delay: 2950 },
  { x: -200, y: 85, scale: 0.55, delay: 3100 },
  { x: 230, y: 85, scale: 0.5, delay: 3250 },
  { x: -280, y: 100, scale: 0.4, delay: 3400 },
] as const;

type Smoke = { x: number; y: number; scale: number; start: number; frames: HTMLImageElement[] };

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
        once: true,
      });
    });
  }
  return image;
}

export class CloneEffect {
  private segmentation: SelfieSegmentation | null = null;
  private mask: CanvasImageSource | null = null;
  private personCanvas = document.createElement("canvas");
  private personCtx = this.personCanvas.getContext("2d");
  private smokeFrames = new Map<string, HTMLImageElement[]>();
  private activeSmokes: Smoke[] = [];
  private spawned = CLONES.map(() => false);
  private startedAt = 0;
  private assetsReady = false;

  constructor(private overlay: HTMLImageElement) {
    if (!this.personCtx) throw new Error("Canvas 2D context is unavailable.");
  }

  async prepareAssets(): Promise<void> {
    if (this.assetsReady) return;
    for (const folder of SMOKE_FOLDERS) {
      const frames = await Promise.all(
        Array.from({ length: SMOKE_FRAME_COUNT }, (_, index) =>
          loadImage(publicUrl(`assets/${folder}/${index + 1}.png`)),
        ),
      );
      this.smokeFrames.set(folder, frames);
    }
    await loadImage(publicUrl("assets/state-2.png"));
    this.assetsReady = true;
  }

  enableSegmentation(): void {
    if (this.segmentation) return;
    const segmentation = new SelfieSegmentation({
      locateFile: (file) => publicUrl(`vendor/selfie_segmentation/${file}`),
    });
    segmentation.setOptions({ modelSelection: 1 });
    segmentation.onResults((result) => {
      this.mask = result.segmentationMask;
    });
    this.segmentation = segmentation;
  }

  async process(video: HTMLVideoElement): Promise<void> {
    await this.segmentation?.send({ image: video });
  }

  canStart(): boolean {
    return this.assetsReady && Boolean(this.mask);
  }

  isActive(): boolean {
    return this.startedAt > 0;
  }

  start(now = performance.now()): boolean {
    if (this.isActive() || !this.canStart()) return false;
    this.startedAt = now;
    this.spawned.fill(false);
    this.activeSmokes.length = 0;
    this.overlay.src = publicUrl("assets/state-2.png");
    this.overlay.dataset.state = "2";
    return true;
  }

  reset(): void {
    this.startedAt = 0;
    this.spawned.fill(false);
    this.activeSmokes.length = 0;
    this.overlay.src = publicUrl("assets/state-1.png");
    this.overlay.dataset.state = "1";
  }

  draw(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    width: number,
    height: number,
  ): void {
    if (!this.isActive() || !this.mask || !this.personCtx) return;
    const now = performance.now();
    const elapsed = now - this.startedAt;
    if (elapsed >= CLONE_EFFECT_DURATION_MS) return;

    const person = this.personCanvas;
    if (person.width !== width || person.height !== height) {
      person.width = width;
      person.height = height;
    }
    this.personCtx.clearRect(0, 0, width, height);
    this.personCtx.globalCompositeOperation = "source-over";
    this.personCtx.drawImage(this.mask, 0, 0, width, height);
    this.personCtx.globalCompositeOperation = "source-in";
    this.personCtx.drawImage(video, 0, 0, width, height);
    this.personCtx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    for (const [index, clone] of CLONES.entries()) {
      if (elapsed < clone.delay) continue;
      if (!this.spawned[index]) {
        this.spawned[index] = true;
        const centerX = clone.x + width / 2;
        const centerY = clone.y + height / 2 - 40;
        this.spawnSmoke(centerX - 15, centerY, clone.scale, now);
        this.spawnSmoke(centerX + 15, centerY, clone.scale, now);
      }
      ctx.save();
      ctx.translate(clone.x + (width * (1 - clone.scale)) / 2, clone.y);
      ctx.scale(clone.scale, clone.scale);
      ctx.drawImage(person, 0, 0);
      ctx.restore();
    }
    this.drawSmokes(ctx, now);
    // Keep the live segmented person in the foreground, matching the original
    // rendering stack: background video -> clones/smoke -> real person.
    ctx.drawImage(person, 0, 0);
    ctx.restore();
  }

  private spawnSmoke(x: number, y: number, scale: number, now: number): void {
    const folder = SMOKE_FOLDERS[Math.floor(Math.random() * SMOKE_FOLDERS.length)];
    const frames = this.smokeFrames.get(folder);
    if (!frames) return;
    this.activeSmokes.push({ x, y, scale: scale * 1.2, start: now, frames });
  }

  private drawSmokes(ctx: CanvasRenderingContext2D, now: number): void {
    const frameDuration = SMOKE_DURATION / SMOKE_FRAME_COUNT;
    for (let index = this.activeSmokes.length - 1; index >= 0; index--) {
      const smoke = this.activeSmokes[index];
      const frameIndex = Math.floor((now - smoke.start) / frameDuration);
      if (frameIndex >= smoke.frames.length) {
        this.activeSmokes.splice(index, 1);
        continue;
      }
      const image = smoke.frames[frameIndex];
      ctx.save();
      ctx.translate(smoke.x, smoke.y);
      ctx.scale(smoke.scale, smoke.scale);
      ctx.drawImage(image, -image.width / 2, -image.height / 2);
      ctx.restore();
    }
  }

  async dispose(): Promise<void> {
    this.reset();
    this.mask = null;
    const segmentation = this.segmentation;
    this.segmentation = null;
    await segmentation?.close().catch(() => {});
  }
}
