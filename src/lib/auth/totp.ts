import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { DomainError } from "@/lib/errors";

/**
 * TOTP (RFC 6238: HMAC-SHA-1, 6 digits, 30-second step) and secret encryption at rest
 * (AES-256-GCM under DATA_ENCRYPTION_KEY, docs/security.md §3.7). No third-party dependency.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accepted clock drift in steps either side (±1 = ±30 s). */
export const TOTP_WINDOW = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (what authenticator apps expect). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function stepAt(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

export function totpAt(secretB32: string, step: number): string {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Returns the matching step within ±TOTP_WINDOW, or null. A step at or before `lastUsedStep`
 * is refused so a code can never be replayed.
 */
export function verifyTotp(secretB32: string, code: string, now: Date, lastUsedStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(now);
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    const step = current + d;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (totpAt(secretB32, step) === code) return step;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string, issuer = "Bryel's Care"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// ---------- encryption at rest ----------

const DEV_KEY_LABEL = "bryels-care-development-only-key";

/**
 * The data-encryption key: DATA_ENCRYPTION_KEY = `keyid:base64(32 bytes)` (a bare base64 value means key id k1).
 * Outside production a fixed development key is used when the variable is unset (never for real
 * data); in production a missing or malformed key is "setup required" and MFA enrolment stops.
 */
function parseKey(raw: string, name: string): { key: Buffer; keyId: string } {
  const m = raw.match(/^([A-Za-z0-9_-]{1,20}):(.+)$/);
  const key = Buffer.from(m ? m[2] : raw, "base64");
  if (key.length !== 32) throw new DomainError("setup_required", name + " must be keyid:base64 of 32 bytes (openssl rand -base64 32).");
  return { key, keyId: m ? m[1] : "k1" };
}

/** Current key (format keyid:base64, docs/deployment-railway.md section 4); DATA_ENCRYPTION_KEY_PREVIOUS still decrypts during rotation. */
function encryptionKey(): { key: Buffer; keyId: string } {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (raw) return parseKey(raw, "DATA_ENCRYPTION_KEY");
  if (process.env.NODE_ENV === "production") {
    throw new DomainError("setup_required", "Two-step sign-in needs DATA_ENCRYPTION_KEY to be set on the server. Ask your system administrator.");
  }
  return { key: createHash("sha256").update(DEV_KEY_LABEL).digest(), keyId: "dev" };
}

function keyById(keyId: string): Buffer {
  const current = encryptionKey();
  if (current.keyId === keyId) return current.key;
  const prev = process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
  if (prev) {
    const p = parseKey(prev, "DATA_ENCRYPTION_KEY_PREVIOUS");
    if (p.keyId === keyId) return p.key;
  }
  throw new DomainError("setup_required", 'The two-step secret was encrypted with key "' + keyId + '", which is not configured.');
}

export function encryptSecret(plain: string): { enc: string; keyId: string } {
  const { key, keyId } = encryptionKey();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { enc: Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url"), keyId };
}

export function decryptSecret(enc: string, keyId: string): string {
  const key = keyById(keyId);
  const buf = Buffer.from(enc, "base64url");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
