import { BeamReceiver } from "./session";
import { $, formatBytes, keepAwake } from "./ui";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare const BarcodeDetector:
  | undefined
  | {
      new (opts: { formats: string[] }): BarcodeDetectorLike;
      getSupportedFormats(): Promise<string[]>;
    };

/** Longest side of the frame handed to the jsQR fallback. */
const SCAN_SIZE = 960;
const WORKERS = 2;

const rx = new BeamReceiver();
let stream: MediaStream | null = null;
let running = false;
let workers: Worker[] = [];
let releaseWake: (() => void) | null = null;
let objectUrl: string | null = null;
let scans = 0;
let lastText = "";
let statsTimer = 0;
let hitTimer = 0;

async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  try {
    if (typeof BarcodeDetector === "undefined") return null;
    const formats = await BarcodeDetector.getSupportedFormats();
    return formats.includes("qr_code") ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

function onText(text: string | null) {
  scans++;
  if (!text || text === lastText || !running) return;
  lastText = text;
  const r = rx.push(text);
  if (r === "foreign") return;
  const reticle = document.querySelector(".reticle")!;
  reticle.classList.add("hit");
  clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => reticle.classList.remove("hit"), 150);
  if (r === "corrupt") $("recv-status").textContent = "That copy failed its integrity check. Starting over…";
  if (r === "complete") finish();
}

function renderStats() {
  const pct = Math.floor(rx.progress * 100);
  $("recv-fill").style.width = `${pct}%`;
  $("recv-progress").setAttribute("aria-valuenow", String(pct));
  if (rx.packets === 0) {
    $("recv-status").textContent = rx.failed
      ? "That copy failed its integrity check. Starting over…"
      : "Looking for a Beamlet stream…";
  } else if (rx.waitingForMeta) {
    $("recv-status").textContent = "Almost there: waiting for the file name…";
  } else {
    $("recv-status").textContent = `Receiving ${rx.fileName ?? "file"} · ${pct}%`;
  }
  const secs = rx.elapsedMs / 1000;
  const rate = secs > 0 ? (rx.progress * rx.bytesTotal) / secs : 0;
  $("recv-stats").textContent =
    rx.packets > 0
      ? `${formatBytes(rx.bytesTotal)} total · ${formatBytes(rate)}/s · ${rx.packets} codes · ${scans} scans/s`
      : `${scans} scans/s`;
  scans = 0;
}

function grabber(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return () => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    // The code sits in the middle of the frame: crop to a centre square.
    const side = Math.min(vw, vh);
    const out = Math.min(side, SCAN_SIZE);
    if (canvas.width !== out) canvas.width = canvas.height = out;
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, out, out);
    return ctx.getImageData(0, 0, out, out);
  };
}

function runWorkers(video: HTMLVideoElement) {
  const grab = grabber(video);
  workers = Array.from({ length: WORKERS }, () => new Worker(new URL("./scan-worker.ts", import.meta.url), { type: "module" }));
  const feed = (w: Worker) => {
    if (!running) return;
    const img = grab();
    if (!img) {
      setTimeout(() => feed(w), 50);
      return;
    }
    w.postMessage({ id: 0, buf: img.data.buffer, width: img.width, height: img.height }, [img.data.buffer]);
  };
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<{ text: string | null }>) => {
      onText(e.data.text);
      feed(w);
    };
    feed(w);
  }
}

function runNative(video: HTMLVideoElement, detector: BarcodeDetectorLike) {
  const loop = async () => {
    while (running) {
      if (video.readyState < 2) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      try {
        const codes = await detector.detect(video);
        if (codes.length === 0) onText(null);
        for (const c of codes) onText(c.rawValue);
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  };
  loop();
}

async function start() {
  const err = $("recv-error");
  err.hidden = true;
  if (!navigator.mediaDevices?.getUserMedia) {
    err.textContent = "This browser can't use the camera here. Beamlet needs HTTPS and a modern browser.";
    err.hidden = false;
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    err.textContent =
      name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access for this site in your browser settings, then try again."
        : name === "NotFoundError"
          ? "No camera was found on this device."
          : `Couldn't start the camera (${name || "unknown error"}).`;
    err.hidden = false;
    return;
  }

  const video = $("video") as HTMLVideoElement;
  video.srcObject = stream;
  await video.play().catch(() => {});
  rx.reset();
  running = true;
  lastText = "";
  scans = 0;
  $("recv-idle").hidden = true;
  $("recv-done").hidden = true;
  $("recv-live").hidden = false;
  keepAwake().then((release) => (releaseWake = release));
  renderStats();
  statsTimer = window.setInterval(renderStats, 1000);

  const detector = await nativeDetector();
  if (detector) runNative(video, detector);
  else runWorkers(video);
}

function stopCamera() {
  running = false;
  clearInterval(statsTimer);
  for (const w of workers) w.terminate();
  workers = [];
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  ($("video") as HTMLVideoElement).srcObject = null;
  releaseWake?.();
  releaseWake = null;
}

function stop() {
  stopCamera();
  $("recv-live").hidden = true;
  $("recv-idle").hidden = false;
}

function finish() {
  const file = rx.result!;
  stopCamera();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  const blob = new Blob([file.bytes], { type: file.mime || "application/octet-stream" });
  objectUrl = URL.createObjectURL(blob);

  $("recv-live").hidden = true;
  $("recv-done").hidden = false;
  $("done-name").textContent = file.name;
  const secs = file.ms / 1000;
  $("done-info").textContent =
    secs < 0.5
      ? `${formatBytes(file.bytes.length)} · received instantly · integrity check passed`
      : `${formatBytes(file.bytes.length)} in ${secs.toFixed(1)} s · ${formatBytes(file.bytes.length / secs)}/s · integrity check passed`;

  const dl = $("done-download") as HTMLAnchorElement;
  dl.href = objectUrl;
  dl.download = file.name;

  const img = $("done-preview") as HTMLImageElement;
  img.hidden = !file.mime.startsWith("image/");
  if (!img.hidden) img.src = objectUrl;

  const isText = file.mime.startsWith("text/");
  const pre = $("done-text");
  pre.hidden = !isText;
  $("done-copy").hidden = !isText || !navigator.clipboard;
  if (isText) pre.textContent = new TextDecoder().decode(file.bytes);

  const shareFile = new File([blob], file.name, { type: blob.type });
  $("done-share").hidden = !navigator.canShare?.({ files: [shareFile] });
  $("done-share").onclick = () => navigator.share({ files: [shareFile] }).catch(() => {});
  $("done-copy").onclick = async () => {
    await navigator.clipboard.writeText(pre.textContent ?? "");
    $("done-copy").textContent = "Copied";
  };
  $("done-name").focus?.();
}

export function initReceive() {
  $("start-recv").addEventListener("click", start);
  $("stop-recv").addEventListener("click", stop);
  $("recv-again").addEventListener("click", () => {
    $("done-copy").textContent = "Copy text";
    start();
  });
}

export function leaveReceive() {
  if (running) stop();
}
