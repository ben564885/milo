// G.711 μ-law <-> 16-bit PCM, for mixing phone audio.
const BIAS = 0x84;
const CLIP = 32635;
const decodeTable = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  decodeTable[i] = sign ? -sample : sample;
}

export function decode(buf: Buffer): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = decodeTable[buf[i]];
  return out;
}

function encodeSample(s: number): number {
  let sign = 0;
  if (s < 0) { sign = 0x80; s = -s; }
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function encode(pcm: Int16Array | Int32Array): Buffer {
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = encodeSample(Math.max(-32768, Math.min(32767, pcm[i])));
  return out;
}

export const FRAME = 160; // 20 ms at 8 kHz
export const SILENCE = Buffer.alloc(FRAME, 0xff);

/** Mix μ-law frames (each FRAME bytes) into one μ-law frame. */
export function mix(frames: Buffer[]): Buffer {
  if (frames.length === 0) return SILENCE;
  if (frames.length === 1) return frames[0];
  const acc = new Int32Array(FRAME);
  for (const f of frames) {
    const d = decode(f);
    for (let i = 0; i < FRAME; i++) acc[i] += d[i];
  }
  return encode(acc);
}
