import QRCode from "qrcode";

/**
 * Draws a QR code onto `canvas` at an integer module scale so every module
 * lands on whole pixels (crisper for cameras than browser-scaled output).
 */
export function drawQr(canvas: HTMLCanvasElement, text: string, opts: { alphanumeric?: boolean; target?: number } = {}) {
  const qr = QRCode.create(opts.alphanumeric ? [{ data: text, mode: "alphanumeric" }] : text, {
    errorCorrectionLevel: "L",
  });
  const { size, data } = qr.modules;
  const quiet = 2;
  const total = size + quiet * 2;
  const scale = Math.max(1, Math.floor((opts.target ?? 900) / total));
  const px = total * scale;
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000";
  for (let r = 0; r < size; r++) {
    let run = -1;
    for (let c = 0; c <= size; c++) {
      const dark = c < size && data[r * size + c];
      if (dark && run < 0) run = c;
      else if (!dark && run >= 0) {
        ctx.fillRect((run + quiet) * scale, (r + quiet) * scale, (c - run) * scale, scale);
        run = -1;
      }
    }
  }
  return size;
}
