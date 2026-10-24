import { describe, expect, it } from "vitest";
import { BeamEncoder, BeamReceiver } from "../src/session";

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);

describe("sender → receiver", () => {
  it("transfers a file with name, type and CRC check, joining mid-stream with losses", () => {
    const file = bytes(30_000);
    const tx = new BeamEncoder(file, "photo.jpg", "image/jpeg", 500);
    const rx = new BeamReceiver();
    for (let i = 0; i < 37; i++) tx.next(); // receiver shows up late
    let last = "accepted";
    for (let i = 0; i < 1000 && last !== "complete"; i++) {
      const text = tx.next();
      if (i % 4 === 1) continue; // dropped frame
      last = rx.push(text);
    }
    expect(last).toBe("complete");
    expect(rx.result).toMatchObject({ name: "photo.jpg", mime: "image/jpeg" });
    expect(rx.result!.bytes).toEqual(file);
  });

  it("sends a tiny message as a single small block", () => {
    const msg = new TextEncoder().encode("hi there");
    const tx = new BeamEncoder(msg, "message.txt", "text/plain", 500);
    expect(tx.blockSize).toBe(msg.length);
    expect(tx.k).toBe(1);
    const rx = new BeamReceiver();
    rx.push(tx.next());
    expect(rx.push(tx.next())).toBe("complete");
    expect(new TextDecoder().decode(rx.result!.bytes)).toBe("hi there");
  });

  it("ignores non-Beamlet QR codes", () => {
    const rx = new BeamReceiver();
    expect(rx.push("HTTPS://EXAMPLE.COM")).toBe("foreign");
    expect(rx.push("hello world")).toBe("foreign");
  });

  it("does not get hijacked by a single stray frame from another stream", () => {
    const a = new BeamEncoder(bytes(5000), "a.bin", "", 500);
    const b = new BeamEncoder(bytes(5000), "b.bin", "", 500);
    const rx = new BeamReceiver();
    for (let i = 0; i < 4; i++) rx.push(a.next());
    expect(rx.push(b.next())).toBe("foreign");
    let r = "";
    while (r !== "complete") r = rx.push(a.next());
    expect(rx.result!.name).toBe("a.bin");
  });

  it("switches to a new stream once it is clearly on screen", () => {
    const a = new BeamEncoder(bytes(5000), "a.bin", "", 500);
    const b = new BeamEncoder(bytes(7000), "b.bin", "", 500);
    const rx = new BeamReceiver();
    for (let i = 0; i < 4; i++) rx.push(a.next());
    let r = "";
    for (let i = 0; i < 500 && r !== "complete"; i++) r = rx.push(b.next());
    expect(rx.result!.name).toBe("b.bin");
    expect(rx.result!.bytes.length).toBe(7000);
  });
});
