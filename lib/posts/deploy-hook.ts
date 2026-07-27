import "server-only";
import { after } from "next/server";
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
//
// SERVICE ROLE THROUGHOUT, and the reason is not convenience. The first cut read
// the hook under the operator's session and only the write-back bypassed RLS.
// That worked from the three paths that return normally and did nothing at all
// from createPost and updatePost, which end in redirect(): the action unwinds by
// throwing NEXT_REDIRECT, and cookies() inside after() does not survive it, so
// the session client failed and the catch below ate the error in silence. The
// callback now has no cookie dependency at all, which also closes the
// mid-refresh window where a lapsed token would have made the read return
// nothing and looked exactly like "this transition needed no rebuild".
//
// The bypass stays narrow and auditable: clientId came from a row already read
// under RLS during the request, so ownership is established before we get here;
// the read touches one column of one row; the write touches two status columns
// of that same row; and the decrypted URL never leaves this callback.
//
// EVERY BRANCH LOGS. This path is designed to fail silently for the operator,
// which is right for them and useless for us: the redirect bug above cost two
// rounds of guessing precisely because the module said nothing. The URL is never
// logged, since it is the credential.

const TIMEOUT_MS = 10_000;
const TAG = "[deploy-hook]";

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
async function recordOutcome(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  status: string
): Promise<void> {
  const { error } = await admin
    .from("clients")
    .update({
      deploy_hook_last_status: status,
      deploy_hook_last_fired_at: new Date().toISOString(),
    })
    .eq("id", clientId);
  if (error) {
    console.error(`${TAG} write-back failed client=${clientId}`, error.code);
    return;
  }
  console.log(`${TAG} outcome client=${clientId} status=${status}`);
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
// which keeps it alive.
export function triggerDeployHook(
  clientId: string | null,
  previousStatus: string | null,
  nextStatus: string | null
): void {
  if (!clientId) {
    console.log(`${TAG} skip: no-client`);
    return;
  }
  if (!publicProjectionChanged(previousStatus, nextStatus)) {
    console.log(
      `${TAG} skip: not-a-public-change client=${clientId} ${previousStatus} -> ${nextStatus}`
    );
    return;
  }

  // Two lines rather than one, and the pair is the point: "scheduled" without a
  // matching "running" means after() itself never fired the callback, which is
  // the exact question that took two rounds to answer without them.
  console.log(
    `${TAG} scheduled client=${clientId} ${previousStatus} -> ${nextStatus}`
  );

  after(async () => {
    console.log(`${TAG} running client=${clientId}`);
    try {
      // No cookies, no session: see the module header. This callback runs after
      // the response and, on the redirect paths, after the action has already
      // unwound, so anything request-scoped is not safe to depend on here.
      const admin = createAdminClient();

      const { data, error } = await admin
        .from("clients")
        .select("deploy_hook_url")
        .eq("id", clientId)
        .maybeSingle();

      if (error) {
        console.error(`${TAG} hook lookup failed client=${clientId}`, error.code);
        return;
      }

      const ciphertext = (data?.deploy_hook_url as string | null) ?? null;
      // No hook stored: this client's site is not static, or one was never
      // pasted in. Not a failure, so nothing is recorded either -- writing a
      // status here would make "never configured" look like "last attempt
      // failed" in the UI.
      if (!ciphertext) {
        console.log(`${TAG} skip: no-hook client=${clientId}`);
        return;
      }

      let url: string;
      try {
        url = decryptToken(ciphertext);
      } catch {
        // The stored payload will not decrypt: the key rotated, or the value was
        // tampered with (GCM's auth tag throws rather than returning garbage).
        // Worth recording, because from the operator's side this looks exactly
        // like a hook that silently stopped working.
        console.error(`${TAG} decrypt failed client=${clientId}`);
        await recordOutcome(admin, clientId, "error");
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
        // text because neither has an HTTP status to record. Only the error NAME
        // is logged: a fetch failure can carry the request URL in its message,
        // and that URL is the credential.
        outcome =
          (error as { name?: string } | null)?.name === "TimeoutError"
            ? "timeout"
            : "error";
        console.error(
          `${TAG} post failed client=${clientId} reason=${outcome}`
        );
      }

      await recordOutcome(admin, clientId, outcome);
    } catch (error) {
      // The last line. Nothing that happens in here may surface to the operator
      // or bring down the invocation: the publish they asked for has already
      // succeeded and been sent. It is logged rather than swallowed silently,
      // because a silent catch here is what hid the redirect bug.
      //
      // Name only, not the message: fetch failures are handled above and cannot
      // reach this catch, but keeping the URL out of the logs is a rule worth
      // holding at every level rather than reasoning about case by case.
      console.error(
        `${TAG} unexpected failure client=${clientId}`,
        (error as { name?: string } | null)?.name ?? "unknown"
      );
    }
  });
}
