// Systematic LT fountain code.
//
// The file is split into k equal blocks. Packet `seed` < k carries block
// `seed` verbatim; any larger seed carries the XOR of a pseudo-random set of
// blocks whose size follows the robust soliton distribution. The receiver can
// start at any frame and miss any frames: roughly k * 1.1–1.3 distinct packets
// of any kind are enough to rebuild the file. No back-channel is needed.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cdfCache = new Map<number, Float64Array>();

/** Cumulative robust soliton distribution over degrees 1..k (index d-1). */
export function robustSolitonCdf(k: number, c = 0.1, delta = 0.5): Float64Array {
  const cached = cdfCache.get(k);
  if (cached) return cached;
  const p = new Float64Array(k);
  if (k === 1) {
    p[0] = 1;
  } else {
    const R = c * Math.log(k / delta) * Math.sqrt(k);
    const pivot = Math.max(1, Math.min(k, Math.floor(k / R)));
    for (let d = 1; d <= k; d++) {
      const rho = d === 1 ? 1 / k : 1 / (d * (d - 1));
      let tau = 0;
      if (d < pivot) tau = R / (d * k);
      else if (d === pivot) tau = (R * Math.log(R / delta)) / k;
      p[d - 1] = rho + Math.max(0, tau);
    }
  }
  let sum = 0;
  for (let i = 0; i < k; i++) sum += p[i];
  let acc = 0;
  for (let i = 0; i < k; i++) {
    acc += p[i] / sum;
    p[i] = acc;
  }
  p[k - 1] = 1;
  cdfCache.set(k, p);
  return p;
}

/** Which source blocks packet `seed` combines. Deterministic on both ends. */
export function blockIndices(seed: number, k: number): number[] {
  if (seed < k) return [seed];
  const rand = mulberry32(Math.imul(seed, 0x9e3779b1) ^ k);
  const cdf = robustSolitonCdf(k);
  const r = rand();
  let degree = 1;
  while (degree < k && cdf[degree - 1] < r) degree++;
  if (degree >= k) return Array.from({ length: k }, (_, i) => i);
  const picked = new Set<number>();
  while (picked.size < degree) picked.add(Math.floor(rand() * k));
  return [...picked];
}

export function splitBlocks(data: Uint8Array, blockSize: number): Uint8Array[] {
  const k = Math.max(1, Math.ceil(data.length / blockSize));
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < k; i++) {
    const b = new Uint8Array(blockSize);
    b.set(data.subarray(i * blockSize, (i + 1) * blockSize));
    blocks.push(b);
  }
  return blocks;
}

export function encodePacket(blocks: Uint8Array[], seed: number): Uint8Array {
  const idx = blockIndices(seed, blocks.length);
  const out = new Uint8Array(blocks[0].length);
  for (const i of idx) {
    const b = blocks[i];
    for (let j = 0; j < out.length; j++) out[j] ^= b[j];
  }
  return out;
}

function xorInto(target: Uint8Array, src: Uint8Array) {
  for (let j = 0; j < target.length; j++) target[j] ^= src[j];
}

interface Pending {
  unknown: Set<number>;
  data: Uint8Array;
}

/** Peeling (belief-propagation) decoder. */
export class FountainDecoder {
  readonly k: number;
  readonly blockSize: number;
  private blocks: (Uint8Array | null)[];
  private pending = new Map<number, Pending>();
  private waiting = new Map<number, Set<number>>();
  private seen = new Set<number>();
  solved = 0;
  received = 0;

  constructor(k: number, blockSize: number) {
    this.k = k;
    this.blockSize = blockSize;
    this.blocks = new Array(k).fill(null);
  }

  get done(): boolean {
    return this.solved === this.k;
  }

  /** Returns false for a duplicate packet. */
  add(seed: number, payload: Uint8Array): boolean {
    if (this.seen.has(seed) || this.done) return false;
    if (payload.length !== this.blockSize) throw new Error("payload size mismatch");
    this.seen.add(seed);
    this.received++;
    const data = payload.slice();
    const unknown = new Set<number>();
    for (const i of blockIndices(seed, this.k)) {
      const known = this.blocks[i];
      if (known) xorInto(data, known);
      else unknown.add(i);
    }
    if (unknown.size === 0) return true;
    if (unknown.size === 1) {
      this.resolve([...unknown][0], data);
      return true;
    }
    this.pending.set(seed, { unknown, data });
    for (const i of unknown) {
      let w = this.waiting.get(i);
      if (!w) this.waiting.set(i, (w = new Set()));
      w.add(seed);
    }
    return true;
  }

  private resolve(index: number, data: Uint8Array) {
    const stack: [number, Uint8Array][] = [[index, data]];
    while (stack.length) {
      const [i, d] = stack.pop()!;
      if (this.blocks[i]) continue;
      this.blocks[i] = d;
      this.solved++;
      const waiters = this.waiting.get(i);
      this.waiting.delete(i);
      if (!waiters) continue;
      for (const pid of waiters) {
        const p = this.pending.get(pid);
        if (!p) continue;
        xorInto(p.data, d);
        p.unknown.delete(i);
        if (p.unknown.size === 1) {
          const [j] = p.unknown;
          this.pending.delete(pid);
          this.waiting.get(j)?.delete(pid);
          stack.push([j, p.data]);
        }
      }
    }
  }

  /** Concatenated file bytes, trimmed to `size`. Only valid once done. */
  assemble(size: number): Uint8Array {
    if (!this.done) throw new Error("not decoded yet");
    const out = new Uint8Array(size);
    for (let i = 0; i < this.k; i++) {
      const start = i * this.blockSize;
      if (start >= size) break;
      out.set(this.blocks[i]!.subarray(0, Math.min(this.blockSize, size - start)), start);
    }
    return out;
  }
}
