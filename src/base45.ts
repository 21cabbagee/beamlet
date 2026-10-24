// Base45 (RFC 9285). Its 45-character alphabet is exactly the QR
// "alphanumeric" charset, so encoded frames use the dense alphanumeric mode
// (~97% as efficient as raw byte mode) and survive any decoder's string output.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function encodeBase45(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 1 < bytes.length; i += 2) {
    let n = bytes[i] * 256 + bytes[i + 1];
    const c = n % 45;
    n = (n - c) / 45;
    const d = n % 45;
    const e = (n - d) / 45;
    out += ALPHABET[c] + ALPHABET[d] + ALPHABET[e];
  }
  if (i < bytes.length) {
    const n = bytes[i];
    out += ALPHABET[n % 45] + ALPHABET[Math.floor(n / 45)];
  }
  return out;
}

export function decodeBase45(text: string): Uint8Array {
  const rem = text.length % 3;
  if (rem === 1) throw new Error("invalid base45 length");
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (rem === 2 ? 1 : 0));
  const val = (ch: number) => {
    const v = ch < 128 ? LOOKUP[ch] : -1;
    if (v < 0) throw new Error("invalid base45 character");
    return v;
  };
  let o = 0;
  let i = 0;
  for (; i + 2 < text.length; i += 3) {
    const n = val(text.charCodeAt(i)) + val(text.charCodeAt(i + 1)) * 45 + val(text.charCodeAt(i + 2)) * 2025;
    if (n > 0xffff) throw new Error("invalid base45 triplet");
    out[o++] = n >> 8;
    out[o++] = n & 0xff;
  }
  if (rem === 2) {
    const n = val(text.charCodeAt(i)) + val(text.charCodeAt(i + 1)) * 45;
    if (n > 0xff) throw new Error("invalid base45 pair");
    out[o++] = n;
  }
  return out;
}
