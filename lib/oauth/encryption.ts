import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// App-level token encryption (AES-256-GCM). OAuth access/refresh tokens are
// encrypted here before they are stored in oauth_connections, and decrypted on
// read. GCM's auth tag means a tampered payload or the wrong key fails to
// decrypt (throws) rather than returning garbage.
//
// The key is process.env.SPOTLIGHT_TOKEN_KEY, base64 for 32 bytes. Generate one
// with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

const IV_BYTES = 12; // standard GCM nonce length
const TAG_BYTES = 16; // GCM auth tag length
const KEY_BYTES = 32; // AES-256

function getKey(): Buffer {
  const raw = process.env.SPOTLIGHT_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      "SPOTLIGHT_TOKEN_KEY is not set. Generate a 32-byte base64 key and add it to .env.local."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SPOTLIGHT_TOKEN_KEY must base64-decode to ${KEY_BYTES} bytes, got ${key.length}. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  return key;
}

// Returns a self-contained base64 payload: iv (12) + auth tag (16) + ciphertext.
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptToken(payload: string): string {
  const key = getKey();
  const data = Buffer.from(payload, "base64");
  if (data.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Invalid token payload: too short.");
  }
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
