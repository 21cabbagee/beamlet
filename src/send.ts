import { drawQr } from "./qr-draw";
import { BeamEncoder } from "./session";
import { $, formatBytes, keepAwake } from "./ui";

const MAX_BYTES = 25 * 1024 * 1024;

let picked: { bytes: Uint8Array; name: string; mime: string } | null = null;
let encoder: BeamEncoder | null = null;
let raf = 0;
let releaseWake: (() => void) | null = null;

function setPicked(bytes: Uint8Array, name: string, mime: string) {
  if (bytes.length > MAX_BYTES) {
    $("drop-label").textContent = `That file is ${formatBytes(bytes.length)}. Try something under ${formatBytes(MAX_BYTES)}.`;
    picked = null;
    ($("start-send") as HTMLButtonElement).disabled = true;
    return;
  }
  picked = { bytes, name, mime };
  $("drop-label").textContent = `${name} · ${formatBytes(bytes.length)}`;
  ($("start-send") as HTMLButtonElement).disabled = false;
}

async function takeFile(file: File) {
  setPicked(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
}

function start() {
  if (!picked) return;
  const blockSize = Number(($("density") as HTMLSelectElement).value);
  encoder = new BeamEncoder(picked.bytes, picked.name, picked.mime, blockSize);
  $("send-setup").hidden = true;
  $("send-live").hidden = false;
  $("send-name").textContent = `${picked.name} · ${formatBytes(picked.bytes.length)}`;
  $("send-stats").textContent = "Starting…";
  window.scrollTo(0, 0);
  keepAwake().then((release) => (releaseWake = release));

  const canvas = $("send-qr") as HTMLCanvasElement;
  const startedAt = performance.now();
  let last = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const fps = Number(($("fps") as HTMLSelectElement).value);
    if (now - last < 1000 / fps - 2) return;
    last = now;
    drawQr(canvas, encoder!.next(), { alphanumeric: true, target: 1000 });
    if (encoder!.frame % 5 === 0) {
      const secs = (now - startedAt) / 1000;
      const passes = (encoder!.frame / encoder!.k).toFixed(1);
      $("send-stats").textContent = `Frame ${encoder!.frame} · ${encoder!.k} blocks · ${passes}× sent · ${secs.toFixed(0)} s`;
    }
  };
  raf = requestAnimationFrame(tick);
}

function stop() {
  cancelAnimationFrame(raf);
  encoder = null;
  releaseWake?.();
  releaseWake = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $("send-live").hidden = true;
  $("send-setup").hidden = false;
}

export function initSend() {
  const input = $("file-input") as HTMLInputElement;
  input.addEventListener("change", () => {
    if (input.files?.[0]) takeFile(input.files[0]);
  });

  const drop = $("drop");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const file = e.dataTransfer?.files[0];
    if (file) takeFile(file);
  });

  $("use-text").addEventListener("click", () => {
    const text = ($("text-input") as HTMLTextAreaElement).value;
    if (!text.trim()) return;
    setPicked(new TextEncoder().encode(text), "message.txt", "text/plain;charset=utf-8");
  });

  $("start-send").addEventListener("click", start);
  $("stop-send").addEventListener("click", stop);
  $("fullscreen").addEventListener("click", () => {
    $("view-send").requestFullscreen?.().catch(() => {});
  });

  drawQr($("invite-qr") as HTMLCanvasElement, location.href.split("#")[0] + "#receive", { target: 200 });
}

export function leaveSend() {
  if (encoder) stop();
}
