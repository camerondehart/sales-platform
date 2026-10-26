/**
 * QR code as a PNG (server only) — emails and social posts can't rely on SVG.
 * Uses the in-house encoder in lib/qr.ts and Node's zlib; no extra packages.
 */

import zlib from "zlib";
import { qrMatrix } from "./qr";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Black-on-white PNG. `scale` = pixels per module; `margin` = quiet zone in modules. */
export function qrPng(text: string, opts: { scale?: number; margin?: number } = {}): Buffer {
  const scale = Math.max(2, Math.min(24, Math.round(opts.scale ?? 8)));
  const margin = opts.margin ?? 4;
  const m = qrMatrix(text);
  const n = m.length + margin * 2;
  const w = n * scale;
  const raw = Buffer.alloc((w + 1) * w, 255);
  for (let y = 0; y < w; y++) {
    raw[y * (w + 1)] = 0; // filter: none
    const r = Math.floor(y / scale) - margin;
    if (r < 0 || r >= m.length) continue;
    for (let x = 0; x < w; x++) {
      const c = Math.floor(x / scale) - margin;
      if (c >= 0 && c < m.length && m[r][c]) raw[y * (w + 1) + 1 + x] = 0x2b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
