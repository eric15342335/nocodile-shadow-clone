// Legacy MediaPipe npm files expose browser globals, not ESM named exports.
export async function loadScript(src: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Unable to load vision resource: ${src}. Reload to retry.`));
    document.head.append(script);
  });
}
