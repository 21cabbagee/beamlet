// Ties the codec pieces together: a file goes in one end as a sequence of
// QR text payloads and comes out the other end verified.
import { decodeBase45, encodeBase45 } from "./base45";
import { crc32 } from "./crc32";
import { FountainDecoder, encodePacket, splitBlocks } from "./fountain";
import { packData, packMeta, unpack, TYPE_META } from "./frame";

/** A meta frame is interleaved this often so late joiners learn the filename. */
const META_EVERY = 8;

export class BeamEncoder {
  readonly session: number;
  readonly size: number;
  readonly k: number;
  private blocks: Uint8Array[];
  private meta: string;
  private seed = 0;
  readonly blockSize: number;
  frame = 0;

  constructor(bytes: Uint8Array, name: string, mime: string, maxBlockSize: number) {
    // Small files get small blocks, so a short note becomes a small, easy code.
    const blockSize = Math.max(1, Math.min(maxBlockSize, bytes.length));
    this.blockSize = blockSize;
    this.session = (crypto.getRandomValues(new Uint32Array(1))[0] || 1) >>> 0;
    this.size = bytes.length;
    this.blocks = splitBlocks(bytes, blockSize);
    this.k = this.blocks.length;
    this.meta = encodeBase45(
      packMeta({ session: this.session, size: this.size, blockSize, crc: crc32(bytes), name, mime }),
    );
  }

  /** Text for the next QR frame. Never runs out. */
  next(): string {
    const f = this.frame++;
    if (f % META_EVERY === 0) return this.meta;
    const seed = this.seed++;
    return encodeBase45(
      packData({
        session: this.session,
        size: this.size,
        blockSize: this.blockSize,
        seed,
        payload: encodePacket(this.blocks, seed),
      }),
    );
  }
}

export interface ReceivedFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
  ms: number;
}

export type PushResult = "foreign" | "duplicate" | "accepted" | "complete" | "corrupt";

/** Frames from another stream needed before we abandon the current one. */
const SWITCH_AFTER = 6;

export class BeamReceiver {
  private session: number | null = null;
  private decoder: FountainDecoder | null = null;
  private size = 0;
  private meta: { name: string; mime: string; crc: number } | null = null;
  private startedAt = 0;
  private rival: { session: number; count: number } | null = null;
  result: ReceivedFile | null = null;
  /** Set when the bytes failed their CRC check; the receiver resets itself. */
  failed = false;

  get progress(): number {
    if (!this.decoder) return 0;
    return this.decoder.solved / this.decoder.k;
  }

  get packets(): number {
    return this.decoder?.received ?? 0;
  }

  get bytesTotal(): number {
    return this.size;
  }

  get fileName(): string | null {
    return this.meta?.name ?? null;
  }

  get elapsedMs(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  get waitingForMeta(): boolean {
    return !!this.decoder?.done && !this.meta;
  }

  push(text: string): PushResult {
    if (this.result) return "duplicate";
    let frame;
    try {
      frame = unpack(decodeBase45(text));
    } catch {
      return "foreign";
    }
    if (!frame) return "foreign";

    if (this.session !== frame.session) {
      if (this.session !== null && this.packets > 0) {
        // Another stream is on screen. Switch only once it's clearly the one being shown.
        if (this.rival?.session === frame.session) this.rival.count++;
        else this.rival = { session: frame.session, count: 1 };
        if (this.rival.count < SWITCH_AFTER) return "foreign";
      }
      this.reset();
      this.session = frame.session;
      this.size = frame.size;
      this.decoder = new FountainDecoder(Math.max(1, Math.ceil(frame.size / frame.blockSize)), frame.blockSize);
      this.startedAt = performance.now();
    }
    this.rival = null;

    let changed = false;
    if (frame.type === TYPE_META) {
      if (!this.meta) {
        this.meta = { name: frame.name, mime: frame.mime, crc: frame.crc };
        changed = true;
      }
    } else if (frame.blockSize === this.decoder!.blockSize) {
      changed = this.decoder!.add(frame.seed, frame.payload);
    }

    if (this.decoder!.done && this.meta) return this.finish();
    return changed ? "accepted" : "duplicate";
  }

  private finish(): PushResult {
    const bytes = this.decoder!.assemble(this.size);
    if (crc32(bytes) !== this.meta!.crc) {
      this.reset();
      this.failed = true;
      return "corrupt";
    }
    this.result = { name: this.meta!.name || "beamlet-file", mime: this.meta!.mime, bytes, ms: this.elapsedMs };
    return "complete";
  }

  reset() {
    this.session = null;
    this.decoder = null;
    this.size = 0;
    this.meta = null;
    this.startedAt = 0;
    this.rival = null;
    this.result = null;
    this.failed = false;
  }
}
