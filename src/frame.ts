// Wire format of one QR frame (before base45):
//
//   data: 'B' | 0x01 | session u32 | size u32 | blockSize u16 | seed u32 | payload
//   meta: 'B' | 0x02 | session u32 | size u32 | blockSize u16 | crc u32 | nameLen u8 | name | mimeLen u8 | mime
//
// Every data frame carries enough to start decoding; meta frames (sent every
// few frames) add the filename, type and a CRC32 for end-to-end verification.

const MAGIC = 0x42; // 'B'
export const TYPE_DATA = 1;
export const TYPE_META = 2;
export const DATA_HEADER = 16;

export interface DataFrame {
  type: typeof TYPE_DATA;
  session: number;
  size: number;
  blockSize: number;
  seed: number;
  payload: Uint8Array;
}

export interface MetaFrame {
  type: typeof TYPE_META;
  session: number;
  size: number;
  blockSize: number;
  crc: number;
  name: string;
  mime: string;
}

export type Frame = DataFrame | MetaFrame;

const enc = new TextEncoder();
const dec = new TextDecoder();

function truncUtf8(s: string, max: number): Uint8Array {
  let b = enc.encode(s);
  while (b.length > max) {
    s = s.slice(0, -1);
    b = enc.encode(s);
  }
  return b;
}

export function packData(f: Omit<DataFrame, "type">): Uint8Array {
  const out = new Uint8Array(DATA_HEADER + f.payload.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, MAGIC);
  v.setUint8(1, TYPE_DATA);
  v.setUint32(2, f.session);
  v.setUint32(6, f.size);
  v.setUint16(10, f.blockSize);
  v.setUint32(12, f.seed);
  out.set(f.payload, DATA_HEADER);
  return out;
}

export function packMeta(f: Omit<MetaFrame, "type">): Uint8Array {
  const name = truncUtf8(f.name, 120);
  const mime = truncUtf8(f.mime, 60);
  const out = new Uint8Array(16 + 1 + name.length + 1 + mime.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, MAGIC);
  v.setUint8(1, TYPE_META);
  v.setUint32(2, f.session);
  v.setUint32(6, f.size);
  v.setUint16(10, f.blockSize);
  v.setUint32(12, f.crc);
  let o = 16;
  out[o++] = name.length;
  out.set(name, o);
  o += name.length;
  out[o++] = mime.length;
  out.set(mime, o);
  return out;
}

/** Parses a frame, or returns null for anything that isn't one of ours. */
export function unpack(bytes: Uint8Array): Frame | null {
  if (bytes.length < 16 || bytes[0] !== MAGIC) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const session = v.getUint32(2);
  const size = v.getUint32(6);
  const blockSize = v.getUint16(10);
  if (blockSize === 0) return null;
  if (bytes[1] === TYPE_DATA) {
    const payload = bytes.subarray(DATA_HEADER);
    if (payload.length !== blockSize) return null;
    return { type: TYPE_DATA, session, size, blockSize, seed: v.getUint32(12), payload };
  }
  if (bytes[1] === TYPE_META) {
    let o = 16;
    const nameLen = bytes[o++];
    if (o + nameLen + 1 > bytes.length) return null;
    const name = dec.decode(bytes.subarray(o, o + nameLen));
    o += nameLen;
    const mimeLen = bytes[o++];
    if (o + mimeLen > bytes.length) return null;
    const mime = dec.decode(bytes.subarray(o, o + mimeLen));
    return { type: TYPE_META, session, size, blockSize, crc: v.getUint32(12), name, mime };
  }
  return null;
}
