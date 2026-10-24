// Off-main-thread QR decoding for browsers without a native BarcodeDetector
// (notably iOS Safari).
import jsQR from "jsqr";

interface ScanRequest {
  id: number;
  buf: ArrayBuffer;
  width: number;
  height: number;
}

self.onmessage = (e: MessageEvent<ScanRequest>) => {
  const { id, buf, width, height } = e.data;
  const code = jsQR(new Uint8ClampedArray(buf), width, height, { inversionAttempts: "dontInvert" });
  (self as unknown as Worker).postMessage({ id, text: code?.data ?? null, buf }, [buf]);
};
