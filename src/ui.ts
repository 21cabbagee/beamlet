export const $ = (id: string) => document.getElementById(id)!;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Keeps the screen on while beaming or scanning, where supported. */
export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request("screen");
    return () => lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}
