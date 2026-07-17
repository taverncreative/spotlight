import "server-only";
import { randomBytes, createHash } from "node:crypto";

// A secret for an inbound sender (GEM CRM and friends). Returns the plaintext
// (shown to the operator once and never stored), a short display prefix, and the
// sha256 hash -- the only thing persisted, and what /api/inbound/feedback
// verifies against. Mirrors lib/content-api/keys.ts.
//
// 32 bytes rather than the content key's 24: this authenticates a WRITE path
// into the triage list, not a read of already-public posts. It matches
// scripts/issue-inbound-source.mts, which issues the same shape from the CLI.
//
// The sptl_in_ prefix keeps an inbound secret from being mistaken for a content
// read key (sptl_) at a glance, in an env file or a support thread.
export function generateSecret(): {
  secret: string;
  secretPrefix: string;
  secretHashHex: string;
} {
  const secret = `sptl_in_${randomBytes(32).toString("base64url")}`;
  return {
    secret,
    // 14 chars, inside the column's 16-char cap, and enough to tell two live
    // secrets apart while being useless on its own.
    secretPrefix: secret.slice(0, 14),
    secretHashHex: createHash("sha256").update(secret).digest("hex"),
  };
}
