import { createAdminClient } from "@/lib/supabase/admin";
import { runAutomationsForLeadCreated } from "@/lib/automations/engine";
import {
  IP_RATE_LIMIT,
  MAX_BODY_BYTES,
  RATE_WINDOW_SECONDS,
  TOKEN_RATE_LIMIT,
  getClientIp,
  isHoneypotTripped,
  mapSubmission,
  parseSubmissionBody,
} from "@/lib/lead-webhooks/intake";

// Public lead-intake endpoint. No auth: the form token is the only key, and
// all work goes through the service role, the same sanctioned pattern as the
// public quote page. A website form POSTs a submission here and it becomes a
// lead in the form's organisation. Nothing reveals whether a token is real:
// an unknown or disabled token, or one whose organisation no longer has the
// leads module, gets the same generic 404 as a malformed one, so the endpoint
// never confirms a form exists and never ingests a lead an organisation could
// not see.

export const dynamic = "force-dynamic";

const generic404 = () => new Response("Not found", { status: 404 });
const success = () => Response.json({ ok: true });

export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;

  // Cheap shape guard before any database work.
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) {
    return generic404();
  }

  const admin = createAdminClient();

  // The token must name an active form.
  const { data: form } = await admin
    .from("webhook_forms")
    .select("id, organisation_id")
    .eq("token", token)
    .eq("status", "active")
    .maybeSingle();
  if (!form) {
    return generic404();
  }

  // The form's organisation must currently have the leads module. Without it
  // the lead would be invisible to everyone, so we refuse to create it, and
  // we refuse the same way we refuse an unknown token.
  const { data: entitlement } = await admin
    .from("organisation_entitlements")
    .select("id")
    .eq("organisation_id", form.organisation_id)
    .eq("module", "leads")
    .maybeSingle();
  if (!entitlement) {
    return generic404();
  }

  // Fixed-window rate limit: per token first, then per source IP. Either over
  // its ceiling is a 429. The limiter increments atomically in Postgres.
  const tokenWithin = await admin.rpc("webhook_rate_limit_hit", {
    p_scope: "token",
    p_key: token,
    p_limit: TOKEN_RATE_LIMIT,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (tokenWithin.error) throw new Error(tokenWithin.error.message);
  if (tokenWithin.data === false) {
    return new Response("Too many requests", { status: 429 });
  }

  const ipWithin = await admin.rpc("webhook_rate_limit_hit", {
    p_scope: "ip",
    p_key: getClientIp(request),
    p_limit: IP_RATE_LIMIT,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (ipWithin.error) throw new Error(ipWithin.error.message);
  if (ipWithin.data === false) {
    return new Response("Too many requests", { status: 429 });
  }

  // Cap the payload size: reject on the declared length before reading, and
  // guard the read itself in case the header lied.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  // Parse the submission by content type: a JSON body or a standard HTML form
  // post (url-encoded). A body that is neither is a bad request.
  const record = parseSubmissionBody(
    request.headers.get("content-type"),
    body
  );
  if (record === null) {
    return new Response("Invalid submission", { status: 400 });
  }

  // Honeypot: if the hidden field is filled, store the lead flagged as spam
  // but answer with the ordinary success response, so a bot learns nothing.
  const spam = isHoneypotTripped(record);
  const mapped = mapSubmission(record);

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      organisation_id: form.organisation_id,
      webhook_form_id: form.id,
      name: mapped.name,
      email: mapped.email,
      phone: mapped.phone,
      message: mapped.message,
      source: "website",
      status: spam ? "spam" : "new",
      // The full submission verbatim, so nothing the form sent is lost.
      raw_payload: record,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Fire the workspace's lead.created automations for a genuine lead. A honeypot
  // spam lead does not fire, so a bot cannot make a workspace create follow-up
  // tasks. Best-effort: a failure here must not turn a stored lead into an error
  // response (which would tell a bot its submission failed); it is swallowed.
  if (!spam) {
    try {
      await runAutomationsForLeadCreated({
        organisationId: form.organisation_id,
        leadId: lead.id,
      });
    } catch (automationError) {
      console.error("Automations engine failed for lead.created", automationError);
    }
  }

  return success();
}
