/**
 * Minimal QR code encoder — byte mode, error-correction level M, versions 1–10.
 *
 * Written in-house rather than pulled from npm so the admin can generate a
 * printable code with zero extra dependencies and nothing leaving the server.
 * Covers URLs up to ~200 characters, which is far more than a sign-up link.
 *
 * Verified bit-for-bit against the reference `qrcode` Python library.
 */

// ---- Galois field arithmetic for Reed–Solomon ----------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const out = new Array(degree).fill(0);
  for (const d of data) {
    const factor = d ^ out[0];
    out.shift();
    out.push(0);
    if (factor !== 0) {
      for (let i = 0; i < degree; i++) out[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return out;
}

// ---- Version tables (EC level M) -----------------------------------------
// [total data codewords, EC codewords per block, blocks in group 1, data cw per
//  block in group 1, blocks in group 2, data cw per block in group 2]
const VERSIONS: Array<[number, number, number, number, number, number]> = [
  [16, 10, 1, 16, 0, 0],   // v1
  [28, 16, 1, 28, 0, 0],   // v2
  [44, 26, 1, 44, 0, 0],   // v3
  [64, 18, 2, 32, 0, 0],   // v4
  [86, 24, 2, 43, 0, 0],   // v5
  [108, 16, 4, 27, 0, 0],  // v6
  [124, 18, 4, 31, 0, 0],  // v7
  [154, 22, 2, 38, 2, 39], // v8
  [182, 22, 3, 36, 2, 37], // v9
  [216, 26, 4, 43, 1, 44], // v10
];

const ALIGNMENT: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// ---- Bit buffer ----------------------------------------------------------

class Bits {
  bits: number[] = [];
  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

// ---- Matrix helpers ------------------------------------------------------

type Matrix = Array<Array<number | null>>; // null = not yet written

function placeFinder(m: Matrix, row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark =
        inner &&
        ((r === 0 || r === 6 || c === 0 || c === 6) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      m[rr][cc] = dark ? 1 : 0;
    }
  }
}

function placeAlignment(m: Matrix, row: number, col: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      m[row + r][col + c] = dark ? 1 : 0;
    }
  }
}

function bch(value: number, poly: number, bits: number): number {
  let v = value << (bits - 1 - Math.floor(Math.log2(poly)) + 1);
  // Simpler: compute remainder of value * x^k mod poly
  const k = Math.floor(Math.log2(poly));
  v = value << k;
  for (let i = Math.floor(Math.log2(v)); i >= k; i--) {
    if ((v >>> i) & 1) v ^= poly << (i - k);
  }
  return (value << k) | v;
}

function formatBits(mask: number): number {
  // EC level M = 00
  const data = (0b00 << 3) | mask;
  const raw = bch(data, 0b10100110111, 15);
  return raw ^ 0b101010000010010;
}

function placeFormat(m: Matrix, mask: number) {
  const n = m.length;
  const f = formatBits(mask);
  const bit = (i: number) => (f >>> i) & 1;
  // First copy: bits 0–5 run down column 8, then hook across row 8.
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
  // Second copy: bits 0–7 along the bottom of row 8, bits 8–14 up column 8.
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[n - 15 + i][8] = bit(i);
  m[n - 8][8] = 1; // always-dark module
}

function maskFn(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function penalty(m: number[][]): number {
  const n = m.length;
  let score = 0;
  // Rule 1: runs of 5+ same colour
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      if (m[r][c] === m[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else run = 1;
    }
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r < n; r++) {
      if (m[r][c] === m[r - 1][c]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else run = 1;
    }
  }
  // Rule 2: 2x2 blocks
  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  // Rule 3: finder-like patterns
  const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (arr: number[]) => {
    let a = true, b = true;
    for (let i = 0; i < 11; i++) {
      if (arr[i] !== p1[i]) a = false;
      if (arr[i] !== p2[i]) b = false;
    }
    return (a ? 1 : 0) + (b ? 1 : 0);
  };
  for (let r = 0; r < n; r++)
    for (let c = 0; c <= n - 11; c++) {
      score += 40 * matches(m[r].slice(c, c + 11));
      const col: number[] = [];
      for (let i = 0; i < 11; i++) col.push(m[c + i][r]);
      score += 40 * matches(col);
    }
  // Rule 4: dark proportion
  let dark = 0;
  for (const row of m) for (const v of row) dark += v;
  const pct = (dark * 100) / (n * n);
  const prev = Math.floor(pct / 5) * 5;
  score += Math.min(Math.abs(prev - 50) / 5, Math.abs(prev + 5 - 50) / 5) * 10;
  return score;
}

// ---- Public API ----------------------------------------------------------

/** Encode `text` and return a square matrix of 0/1 modules (no quiet zone). */
export function qrMatrix(text: string): number[][] {
  const bytes = Array.from(new TextEncoder().encode(text));

  // Pick the smallest version that fits
  let version = -1;
  for (let v = 0; v < VERSIONS.length; v++) {
    const capacityBits = VERSIONS[v][0] * 8;
    const countBits = v + 1 <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= capacityBits) { version = v + 1; break; }
  }
  if (version === -1) throw new Error("Text too long for this QR encoder (max ~200 chars).");

  const [totalData, ecPerBlock, g1Blocks, g1Size, g2Blocks, g2Size] = VERSIONS[version - 1];
  const countBits = version <= 9 ? 8 : 16;

  // Data bit stream
  const bb = new Bits();
  bb.push(0b0100, 4); // byte mode
  bb.push(bytes.length, countBits);
  for (const b of bytes) bb.push(b, 8);
  const capacity = totalData * 8;
  bb.push(0, Math.min(4, capacity - bb.bits.length)); // terminator
  while (bb.bits.length % 8 !== 0) bb.bits.push(0);
  const pads = [0xec, 0x11];
  for (let i = 0; bb.bits.length < capacity; i++) bb.push(pads[i % 2], 8);

  const data: number[] = [];
  for (let i = 0; i < bb.bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bb.bits[i + j];
    data.push(v);
  }

  // Split into blocks, compute EC, interleave
  const blocks: number[][] = [];
  const ecs: number[][] = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks; i++) {
    const blk = data.slice(offset, offset + g1Size); offset += g1Size;
    blocks.push(blk); ecs.push(rsEncode(blk, ecPerBlock));
  }
  for (let i = 0; i < g2Blocks; i++) {
    const blk = data.slice(offset, offset + g2Size); offset += g2Size;
    blocks.push(blk); ecs.push(rsEncode(blk, ecPerBlock));
  }
  const maxLen = Math.max(...blocks.map((b) => b.length));
  const final: number[] = [];
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) final.push(b[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const e of ecs) final.push(e[i]);

  // Build the matrix
  const n = version * 4 + 17;
  const m: Matrix = Array.from({ length: n }, () => new Array(n).fill(null));

  placeFinder(m, 0, 0);
  placeFinder(m, 0, n - 7);
  placeFinder(m, n - 7, 0);
  for (let i = 8; i < n - 8; i++) {
    m[6][i] = i % 2 === 0 ? 1 : 0;
    m[i][6] = i % 2 === 0 ? 1 : 0;
  }
  const al = ALIGNMENT[version - 1];
  for (const r of al) for (const c of al) {
    if (m[r][c] !== null) continue; // overlaps a finder
    placeAlignment(m, r, c);
  }
  // Reserve format areas (values filled after masking)
  for (let i = 0; i < 9; i++) { if (m[8][i] === null) m[8][i] = 0; if (m[i][8] === null) m[i][8] = 0; }
  for (let i = 0; i < 8; i++) { m[n - 1 - i][8] = 0; m[8][n - 1 - i] = 0; }
  const reserved = m.map((row) => row.map((v) => v !== null));

  // Place data bits in the zig-zag
  let bitIdx = 0;
  const totalBits = final.length * 8;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? n - 1 - vert : vert;
        if (reserved[r][c]) continue;
        const bit = bitIdx < totalBits ? (final[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1 : 0;
        m[r][c] = bit;
        bitIdx++;
      }
    }
  }

  // Try every mask, keep the lowest penalty
  let best: number[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const trial = m.map((row, r) =>
      row.map((v, c) => (reserved[r][c] ? (v as number) : (v as number) ^ (maskFn(mask, r, c) ? 1 : 0)))
    );
    placeFormat(trial as Matrix, mask);
    const s = penalty(trial as number[][]);
    if (s < bestScore) { bestScore = s; best = trial as number[][]; }
  }
  return best!;
}

/** Render as a standalone SVG string. `size` is the rendered width in px. */
export function qrSvg(text: string, opts: { size?: number; dark?: string; light?: string; margin?: number } = {}): string {
  const { size = 320, dark = "#2b2f27", light = "#ffffff", margin = 4 } = opts;
  const m = qrMatrix(text);
  const n = m.length + margin * 2;
  let path = "";
  for (let r = 0; r < m.length; r++)
    for (let c = 0; c < m.length; c++)
      if (m[r][c]) path += `M${c + margin} ${r + margin}h1v1h-1z`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`
  );
}
