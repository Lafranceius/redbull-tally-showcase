import { deflateSync } from 'node:zlib';

// Home-screen icon drawn in code: a plain can silhouette on near-black, in the app's own
// palette. No logos or brand assets.

type RGB = [number, number, number];
const BG: RGB = [0x0b, 0x0b, 0x0c];
const CREAM: RGB = [0xf2, 0xe9, 0xda];
const RIM: RGB = [0xa6, 0x9e, 0x92];
const PEACH: RGB = [0xff, 0x9b, 0x76];

function inRoundedRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number): boolean {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Colour at (u, v) in [0, 1]². */
function shade(u: number, v: number): RGB {
  if (!inRoundedRect(u, v, 0.33, 0.17, 0.67, 0.83, 0.04)) return BG;
  if (v < 0.22 || v > 0.79) return RIM;
  if (v > 0.43 && v < 0.57) return PEACH;
  return CREAM;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Renders a square RGB PNG, 4×4 supersampled for smooth edges. */
export function renderIcon(size: number): Buffer {
  const SS = 4;
  const rowLen = size * 3 + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [cr, cg, cb] = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += cr; g += cg; b += cb;
        }
      }
      const o = y * rowLen + 1 + x * 3;
      raw[o] = Math.round(r / SS ** 2);
      raw[o + 1] = Math.round(g / SS ** 2);
      raw[o + 2] = Math.round(b / SS ** 2);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const cache = new Map<number, Buffer>();

export function iconPng(size: number): Buffer {
  let png = cache.get(size);
  if (!png) cache.set(size, (png = renderIcon(size)));
  return png;
}
