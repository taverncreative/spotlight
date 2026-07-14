import "server-only";
import { randomBytes, createHash } from "node:crypto";

// A per-client content-API read key. Returns the plaintext (shown to the
// operator once and never stored), a short display prefix, and the sha256 hash
// -- the only thing persisted, and what the public endpoint verifies against.
export function generateKey(): {
  key: string;
  keyPrefix: string;
  keyHashHex: string;
} {
  const key = `sptl_${randomBytes(24).toString("base64url")}`;
  return {
    key,
    keyPrefix: key.slice(0, 14),
    keyHashHex: createHash("sha256").update(key).digest("hex"),
  };
}
