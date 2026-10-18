import { sanitizePairingUrl } from "./dashboard";

/**
 * Minimal ISO/IEC 18004 QR Code matrix generator (Byte mode, ECC Level L, Versions 1–6)
 * used strictly for encoding sanitized HTTPS gateway URLs (never tokens or secrets).
 */

const VERSION_CAPACITIES = [0, 17, 32, 53, 78, 106, 134];
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172];
const EC_CODEWORDS_PER_BLOCK = [0, 7, 10, 15, 20, 26, 18];
const NUM_BLOCKS = [0, 1, 1, 1, 1, 1, 2];
const ALIGNMENT_POSITIONS: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

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
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]!;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i]!;
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]!;
      next[j + 1] ^= gfMul(poly[j]!, factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i]!;
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j]!, coef);
      }
    }
  }
  return msg.slice(data.length);
}

function bchFormatBits(ecLevel: number, mask: number): number {
  const data = ((ecLevel << 3) | mask) << 10;
  let rem = data;
  for (let i = 14; i >= 10; i--) {
    if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  }
  return ((data | rem) ^ 0x5412) & 0x7fff;
}

export function encodeGatewayAddressQr(rawUrl: string): boolean[][] {
  const cleanUrl = sanitizePairingUrl(rawUrl);
  const bytes = new TextEncoder().encode(cleanUrl);
  let version = 1;
  while (version <= 6 && bytes.length > VERSION_CAPACITIES[version]!) {
    version++;
  }
  if (version > 6) {
    throw new Error("Gateway URL is too long for compact QR display.");
  }

  const totalCodewords = TOTAL_CODEWORDS[version]!;
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK[version]!;
  const blocks = NUM_BLOCKS[version]!;
  const dataCapacity = totalCodewords - ecPerBlock * blocks;

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  // Byte mode indicator (0100) + 8-bit character count (versions 1-9)
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);
  pushBits(0, Math.min(4, dataCapacity * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(dataCapacity);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b]!;
    dataBytes[i] = byte;
  }
  const pads = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < dataCapacity; i++, p ^= 1) {
    dataBytes[i] = pads[p]!;
  }

  const blockSize = Math.floor(dataCapacity / blocks);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  for (let b = 0; b < blocks; b++) {
    const slice = dataBytes.slice(b * blockSize, (b + 1) * blockSize);
    dataBlocks.push(slice);
    ecBlocks.push(rsEncode(slice, ecLenFor(ecPerBlock)));
  }

  const finalCodewords: number[] = [];
  for (let i = 0; i < blockSize; i++) {
    for (let b = 0; b < blocks; b++) finalCodewords.push(dataBlocks[b]![i]!);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < blocks; b++) finalCodewords.push(ecBlocks[b]![i]!);
  }

  const size = 17 + version * 4;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunction = (r: number, c: number, val: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r]![c] = val;
    isFunction[r]![c] = true;
  };

  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onRing = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunction(top + dr, left + dc, inOuter && (onRing || inCenter));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  const align = ALIGNMENT_POSITIONS[version]!;
  for (const ar of align) {
    for (const ac of align) {
      if (
        (ar === 6 && ac === 6) ||
        (ar === 6 && ac === size - 7) ||
        (ar === size - 7 && ac === 6)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const val = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunction(ar + dr, ac + dc, val);
        }
      }
    }
  }

  // Reserve format info areas + dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunction(8, i, false);
      setFunction(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunction(8, size - 1 - i, false);
    setFunction(size - 1 - i, 8, false);
  }
  setFunction(size - 8, 8, true);

  // Place data bits upward/downward in 2-column zigzags
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunction[r]![c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            dark = ((finalCodewords[bitIdx >> 3]! >> (7 - (bitIdx & 7))) & 1) !== 0;
            bitIdx++;
          }
          // Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) dark = !dark;
          modules[r]![c] = dark;
        }
      }
    }
    upward = !upward;
  }

  // Write format bits for ECC Level L (01) and Mask 0 (000)
  const fmt = bchFormatBits(0b01, 0);
  for (let i = 0; i <= 5; i++) setFunction(8, i, ((fmt >> i) & 1) !== 0);
  setFunction(8, 7, ((fmt >> 6) & 1) !== 0);
  setFunction(8, 8, ((fmt >> 7) & 1) !== 0);
  setFunction(7, 8, ((fmt >> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) setFunction(14 - i, 8, ((fmt >> i) & 1) !== 0);

  for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, ((fmt >> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, ((fmt >> i) & 1) !== 0);

  return modules;
}

function ecLenFor(len: number) {
  return len;
}
