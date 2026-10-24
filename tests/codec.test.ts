import { describe, expect, it } from "vitest";
import { decodeBase45, encodeBase45 } from "../src/base45";
import { crc32 } from "../src/crc32";
import { FountainDecoder, encodePacket, splitBlocks } from "../src/fountain";
import { packData, packMeta, unpack, TYPE_DATA, TYPE_META } from "../src/frame";

function randomBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe("base45", () => {
  it("matches RFC 9285 examples", () => {
    expect(encodeBase45(new TextEncoder().encode("AB"))).toBe("BB8");
    expect(encodeBase45(new TextEncoder().encode("Hello!!"))).toBe("%69 VD92EX0");
    expect(new TextDecoder().decode(decodeBase45("QED8WEX0"))).toBe("ietf!");
  });

  it("round-trips arbitrary bytes of every length parity", () => {
    for (const n of [0, 1, 2, 3, 255, 1000, 1001]) {
      const b = randomBytes(n, n + 7);
      expect(decodeBase45(encodeBase45(b))).toEqual(b);
    }
  });

  it("rejects garbage", () => {
    expect(() => decodeBase45("a")).toThrow();
    expect(() => decodeBase45("abc")).toThrow();
    expect(() => decodeBase45("GGW")).toThrow(); // > 0xffff
  });
});

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("frames", () => {
  it("round-trips data and meta frames", () => {
    const payload = randomBytes(64);
    const d = unpack(packData({ session: 0xdeadbeef, size: 1234, blockSize: 64, seed: 99, payload }));
    expect(d).toMatchObject({ type: TYPE_DATA, session: 0xdeadbeef, size: 1234, blockSize: 64, seed: 99 });
    expect(d && d.type === TYPE_DATA && d.payload).toEqual(payload);

    const m = unpack(packMeta({ session: 7, size: 10, blockSize: 64, crc: 0xcbf43926, name: "fötø.jpg", mime: "image/jpeg" }));
    expect(m).toEqual({ type: TYPE_META, session: 7, size: 10, blockSize: 64, crc: 0xcbf43926, name: "fötø.jpg", mime: "image/jpeg" });
  });

  it("ignores foreign QR codes", () => {
    expect(unpack(new TextEncoder().encode("https://example.com/some/link"))).toBeNull();
  });
});

describe("fountain code", () => {
  function transfer(size: number, blockSize: number, opts: { lossEvery?: number; startAt?: number }) {
    const file = randomBytes(size, size);
    const blocks = splitBlocks(file, blockSize);
    const dec = new FountainDecoder(blocks.length, blockSize);
    let seed = opts.startAt ?? 0;
    let sent = 0;
    while (!dec.done) {
      if (sent > blocks.length * 5 + 100) throw new Error("did not converge");
      const s = seed++;
      sent++;
      if (opts.lossEvery && sent % opts.lossEvery === 0) continue;
      dec.add(s, encodePacket(blocks, s));
    }
    expect(dec.assemble(size)).toEqual(file);
    return dec.received / blocks.length;
  }

  it("decodes a clean stream from the start", () => {
    expect(transfer(50_000, 500, {})).toBeLessThanOrEqual(1);
  });

  it("decodes when the receiver joins late and drops a third of frames", () => {
    const overhead = transfer(200_000, 700, { startAt: 150, lossEvery: 3 });
    expect(overhead).toBeLessThan(1.6);
  });

  it("decodes a stream of only encoded (non-systematic) packets", () => {
    const overhead = transfer(100_000, 400, { startAt: 1_000_000 });
    expect(overhead).toBeLessThan(1.6);
  });

  it("handles tiny files", () => {
    transfer(1, 500, {});
    transfer(0, 500, { startAt: 10 });
    transfer(10, 500, { startAt: 10 });
  });

  it("ignores duplicates", () => {
    const blocks = splitBlocks(randomBytes(3000), 500);
    const dec = new FountainDecoder(blocks.length, 500);
    expect(dec.add(9, encodePacket(blocks, 9))).toBe(true);
    expect(dec.add(9, encodePacket(blocks, 9))).toBe(false);
    expect(dec.received).toBe(1);
  });
});
