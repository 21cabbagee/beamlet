# Beamlet

Send a file from one device to another by flashing QR codes. One screen plays a
stream of codes, the other device's camera reads them. No Wi-Fi, Bluetooth,
pairing, account or server: the file never leaves the two devices.

**Live:** https://21cabbagee.github.io/beamlet/

## Use it

1. Open Beamlet on both devices. (The Send page shows a small QR code that opens
   the app on the receiver.)
2. **Sender:** choose a file, or paste some text, then press **Start beaming**.
   Turn the screen brightness up. Full screen helps.
3. **Receiver:** open **Receive**, press **Start camera**, and point it at the
   sender's screen. You can join at any point, and missed frames don't matter.
4. When the progress bar fills up, the file is checked (CRC32) and you can
   save, share or copy it.

If codes aren't being picked up, lower **Density** first, then **Speed**.

## How it works

- **Fountain code.** The file is split into *k* blocks. The first *k* frames
  carry the blocks as they are. Every frame after that carries the XOR of a
  pseudo-random set of blocks, sized by a robust soliton distribution
  (`src/fountain.ts`). Any ~*k* frames, from any point in the stream, are
  enough to rebuild the file, so the receiver never has to ask for a resend.
- **Base45 in alphanumeric mode.** Frames are binary, encoded with Base45
  (RFC 9285). Its alphabet is exactly QR's alphanumeric character set, so codes
  use the dense alphanumeric mode and survive any scanner's text output
  (`src/base45.ts`).
- **Frames.** Each data frame has a 16-byte header: stream id, file size, block
  size, packet seed. Every 8th frame is a metadata frame with the filename, MIME
  type and CRC32 (`src/frame.ts`).
- **Scanning.** Uses the browser's native `BarcodeDetector` where available
  (Chrome/Android). Otherwise it uses [jsQR](https://github.com/cozmo/jsQR) in
  two Web Workers on a centre-cropped frame (iOS Safari, Firefox).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # codec + end-to-end session tests
npm run build      # static site in dist/
```

Pushing to `main` builds, tests and deploys to GitHub Pages through
`.github/workflows/deploy.yml`.

The camera only works over HTTPS (or on `localhost`). To test with a phone
during development, use the deployed Pages URL.

## Limits

- Throughput depends on both screens and cameras. Small files (KB to a few MB)
  are the sweet spot.
- One-way only: the sender can't tell when the receiver has finished, so stop
  it by hand.
- Files are held in memory; the sender caps them at 25 MB.

## Credits

The idea of sending files optically with animated QR codes has been around for a
long time. Beamlet is an independent implementation written from scratch, MIT
licensed. It uses [`qrcode`](https://github.com/soldair/node-qrcode) and
[`jsQR`](https://github.com/cozmo/jsQR).
