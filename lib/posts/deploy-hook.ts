import "server-only";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/oauth/encryption";

// The firing half of the deploy hook (storage is slice 1, migration 0060).
//
// A client on a static site (Astro) bakes its posts at build time from the
// content API, so the live site keeps serving the old set until the site
// rebuilds. This module is what asks it to rebuild.
//
// THE RULE: fire when the public projection changes, meaning the new status is
// published OR the old status was published. Only draft -> draft is skipped,
// which is the frequent case while writing and the one that would otherwise
// spam the hook on every autosave-shaped edit.
//
// That the rule is symmetric matters. Publishing is the obvious case, but
// editing an already-published post leaves the live site serving stale content,
// and unpublishing or deleting one leaves it serving a post the operator
// believes is gone. That last is the worst of the three, because nothing in
// Spotlight would show it is still up.
//
// NOTHING HERE MAY EVER FAIL A PUBLISH. The whole body runs inside after(), so
// it happens once the response is already sent, and every failure path is
// swallowed. A revoked hook, a dead host or a slow one costs the operator
// nothing but a recorded status.

const TIMEOUT_MS = 10_000;

// Whether a status transition changes what the client's public site serves.
// null on either side is meaningful: previous is null for a brand-new post,
// next is null for a deleted one.
function publicProjectionChanged(
  previous: string | null,
  next: string | null
): boolean {
  return next === "published" || previous === "published";
}

// Overwrite the last-fire record. Best effort by nature: it runs after the
// response, so a failure here has nobody to tell. Read the stored value as
// "the build was QUEUED", never "the post is live" (see 0060).
//
// SERVICE ROLE, deliberately, and the only place in this module that uses it.
// This runs inside after(), so the operator's access token may be mid-refresh by
// the time it fires: the session client would then be unauthenticated and the
// update would silently no-op under RLS, leaving the hook fired but no status
// recorded. That is an intermittent, timing-dependent hole with no error to
// follow, which is the worst kind to inherit.
//
// The bypass is narrow and safe to audit: clientId came from a row already read
// under RLS during the request, so ownership is established before we get here;
// the write touches two status columns and cannot reach any other row, table or
// field; and the value written is a status string this module produced, never
// anything from a caller.
async function recordOutcome(
  clientId: string,
  status: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("clients")
    .update({
      deploy_hook_last_status: status,
      deploy_hook_last_fired_at: new Date().toISOString(),
    })
    .eq("id", clientId);
}

// Ask the client's host to rebuild, if this transition warrants it and that
// client has a hook stored.
//
// Synchronous and returns void on purpose: the caller must not be able to await
// it by accident, because awaiting would put a third-party HTTP call back on the
// path of the publish it is meant to stay off. Call it and move on.
//
// Registering with after() rather than a bare `void fetch(...)` is load-bearing
// on Vercel: once the response is sent the invocation can be frozen, so a
// detached promise may never leave the machine. after() is backed by waitUntil,
// which keeps it alive. It also survives the redirect() that createPost and
// updatePost end on, which would otherwise unwind before a detached call ran.
export function triggerDeployHook(
  clientId: string | null,
  previousStatus: string | null,
  nextStatus: string | null
): void {
  if (!clientId) return;
  if (!publicProjectionChanged(previousStatus, nextStatus)) return;

  after(async () => {
    try {
      // The READ stays on the operator's session, so RLS scopes which client's
      // hook can be fetched. cookies() is readable inside after() in a Server
      // Function, and the SSR client's setAll already swallows the
      // post-response cookie write it cannot make.
      //
      // Note the asymmetry with recordOutcome below, which uses service role.
      // This read carries the same mid-refresh exposure: if the session has
      // lapsed by the time after() runs, the select returns nothing, the hook
      // does not fire and nothing is recorded, which reads as "this transition
      // did not warrant a rebuild". Kept session-scoped anyway, because
      // bypassing RLS to fetch a stored CREDENTIAL is a wider bypass than
      // bypassing it to stamp a status, and the two deserve separate decisions.
      const supabase = await createClient();

      const { data } = await supabase
        .from("clients")
        .select("deploy_hook_url")
        .eq("id", clientId)
        .maybeSingle();

      const ciphertext = (data?.deploy_hook_url as string | null) ?? null;
      // No hook stored: this client's site is not static, or one was never
      // pasted in. Not a failure, so nothing is recorded either -- writing a
      // status here would make "never configured" look like "last attempt
      // failed" in the UI.
      if (!ciphertext) return;

      let url: string;
      try {
        url = decryptToken(ciphertext);
      } catch {
        // The stored payload will not decrypt: the key rotated, or the value was
        // tampered with (GCM's auth tag throws rather than returning garbage).
        // Worth recording, because from the operator's side this looks exactly
        // like a hook that silently stopped working.
        await recordOutcome(clientId, "error");
        return;
      }

      let outcome: string;
      try {
        // No body and no auth header: for Vercel, Netlify and Cloudflare Pages
        // the URL itself is the credential, and they accept a bare POST. They
        // return as soon as the build is QUEUED, so this does not wait on a
        // build and the timeout is generous rather than tight.
        const res = await fetch(url, {
          method: "POST",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        outcome = String(res.status);
      } catch (error) {
        // AbortSignal.timeout rejects with a DOMException named TimeoutError.
        // Everything else (DNS, refused, TLS) is an 'error'. Both are stored as
        // text because neither has an HTTP status to record.
        outcome =
          (error as { name?: string } | null)?.name === "TimeoutError"
            ? "timeout"
            : "error";
      }

      await recordOutcome(clientId, outcome);
    } catch {
      // The last line. Nothing that happens in here may surface to the operator
      // or bring down the invocation: the publish they asked for has already
      // succeeded and been sent.
    }
  });
}
