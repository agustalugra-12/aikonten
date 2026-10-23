import crypto from "crypto";

// TOTP RFC 6238 (SHA1, 6 digit, step 30s) - hand-rolled pakai Node crypto (tanpa dependency;
// algoritma standar, diuji vs test-vector RFC). Kompatibel Google Authenticator/Authy.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0, val = 0, out = "";
  for (const byte of buf) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0, val = 0; const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  // counter 64-bit big-endian (writeBigUInt64BE aman utk rentang waktu)
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

export function totpAt(secret: string, timeMs: number, step = 30): string {
  return hotp(secret, Math.floor(timeMs / 1000 / step));
}

// Verifikasi token dgn toleransi +/- `window` langkah (clock drift). Bandingkan konstan-waktu.
export function verifyTotp(secret: string, token: string, window = 1, timeMs = Date.now()): boolean {
  const t = (token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(t)) return false;
  const counter = Math.floor(timeMs / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    const expected = hotp(secret, counter + w);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(t))) return true;
  }
  return false;
}

export function otpauthUri(label: string, secret: string, issuer = "KontenPilot"): string {
  const l = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${l}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Self-check RFC 6238 vector: seed ASCII "12345678901234567890" @ t=59s -> 287082 (6 digit).
export function _selfCheck(): boolean {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  return totpAt(secret, 59_000) === "287082";
}
