const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = 0;
let lastRandom: Uint8Array = new Uint8Array(10);

function encodeTime(now: number, len: number): string {
  let out = "";
  let t = now;
  for (let i = len - 1; i >= 0; i--) {
    out = ENCODING[t % 32]! + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  // Encode 80 bits (10 bytes) as 16 base32 characters (5 bits each)
  const b = bytes;
  return (
    ENCODING[(b[0]! >> 3) & 0x1f]! +
    ENCODING[((b[0]! << 2) | (b[1]! >> 6)) & 0x1f]! +
    ENCODING[(b[1]! >> 1) & 0x1f]! +
    ENCODING[((b[1]! << 4) | (b[2]! >> 4)) & 0x1f]! +
    ENCODING[((b[2]! << 1) | (b[3]! >> 7)) & 0x1f]! +
    ENCODING[(b[3]! >> 2) & 0x1f]! +
    ENCODING[((b[3]! << 3) | (b[4]! >> 5)) & 0x1f]! +
    ENCODING[b[4]! & 0x1f]! +
    ENCODING[(b[5]! >> 3) & 0x1f]! +
    ENCODING[((b[5]! << 2) | (b[6]! >> 6)) & 0x1f]! +
    ENCODING[(b[6]! >> 1) & 0x1f]! +
    ENCODING[((b[6]! << 4) | (b[7]! >> 4)) & 0x1f]! +
    ENCODING[((b[7]! << 1) | (b[8]! >> 7)) & 0x1f]! +
    ENCODING[(b[8]! >> 2) & 0x1f]! +
    ENCODING[((b[8]! << 3) | (b[9]! >> 5)) & 0x1f]! +
    ENCODING[b[9]! & 0x1f]!
  );
}

function fillRandom(): Uint8Array {
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return buf;
}

function bumpRandom(buf: Uint8Array): Uint8Array {
  const out = new Uint8Array(buf);
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]! < 255) {
      out[i]!++;
      return out;
    }
    out[i] = 0;
  }
  return out;
}

export function ulid(): string {
  const now = Date.now();
  if (now === lastTime) {
    lastRandom = bumpRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = fillRandom();
  }
  return encodeTime(now, 10) + encodeRandom(lastRandom);
}

export function formatIdentifier(n: number): string {
  return `PENTAS-${n}`;
}
