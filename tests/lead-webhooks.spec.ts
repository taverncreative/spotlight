// Lead-intake webhook test for Pass 4A. Runs with: npm run test:lead-webhooks
//
// All requests are real HTTP with no session, because the endpoint is public
// and the form token is the only key. Proves: a valid submission becomes a
// mapped lead in the form's organisation with the raw payload kept verbatim,
// source website, status new, linked to the form; an unknown token, a
// disabled form and a form whose organisation lacks the leads entitlement
// each return a generic 404 and create nothing; a honeypot submission is
// stored as spam yet still answered with success; the per-token and per-IP
// fixed-window rate limits return 429 once exceeded; an oversized body is
// rejected; and the token is the only key, so a submission can only ever
// create a lead in its own form's organisation. Pass 4C adds the url-encoded
// path: a plain HTML form post (no JavaScript) creates a lead just as a JSON
// post does, the honeypot catches spam on that path too, and the plain HTML
// example uses exactly the fields the endpoint maps.

import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  buildExampleFormHtml,
  HONEYPOT_FIELD,
  IP_RATE_LIMIT,
  MAPPED_FIELDS,
  TOKEN_RATE_LIMIT,
} from "../lib/lead-webhooks/intake";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const forms: Record<string, { id: string; token: string }> = {};

// Every request carries a distinct synthetic source IP by default, so the
// per-IP limiter never trips incidentally during unrelated assertions. The
// rate-limit tests pass an explicit ip to accumulate against one bucket.
let ipSeq = 0;
function nextIp() {
  ipSeq += 1;
  return `192.0.2.${(ipSeq % 250) + 1}`;
}

function postLead(
  request: APIRequestContext,
  token: string,
  body: unknown,
  opts: { ip?: string; raw?: string } = {}
) {
  const data = opts.raw !== undefined ? opts.raw : JSON.stringify(body ?? {});
  return request.post(`/api/lead-webhooks/${token}`, {
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": opts.ip ?? nextIp(),
    },
    data,
    failOnStatusCode: false,
  });
}

// Post like a plain HTML form with no JavaScript: the browser sends
// application/x-www-form-urlencoded, which Playwright's `form` option mirrors.
function postForm(
  request: APIRequestContext,
  token: string,
  fields: Record<string, string>
) {
  return request.post(`/api/lead-webhooks/${token}`, {
    form: fields,
    headers: { "x-forwarded-for": nextIp() },
    failOnStatusCode: false,
  });
}

async function createOrg(label: string, withLeads: boolean) {
  const org = await admin
    .from("organisations")
    .insert({ name: `Webhook ${label} ${run}`, slug: `wh-${label}-${run}` })
    .select("id")
    .single();
  if (org.error) throw new Error(org.error.message);
  orgIds[label] = org.data.id;
  if (withLeads) {
    const ent = await admin
      .from("organisation_entitlements")
      .insert({ organisation_id: org.data.id, module: "leads", source: "add_on" });
    if (ent.error) throw new Error(ent.error.message);
  }
  return org.data.id;
}

async function createForm(orgLabel: string, name: string, status = "active") {
  const form = await admin
    .from("webhook_forms")
    .insert({ organisation_id: orgIds[orgLabel], name, status })
    .select("id, token")
    .single();
  if (form.error) throw new Error(form.error.message);
  return { id: form.data.id as string, token: form.data.token as string };
}

test.beforeAll(async () => {
  await createOrg("a", true); // has the leads module
  await createOrg("b", true); // a second tenant, also with leads
  await createOrg("c", false); // a tenant WITHOUT the leads module

  forms.active = await createForm("a", `Contact form ${run}`);
  forms.disabled = await createForm("a", `Old form ${run}`, "disabled");
  forms.flood = await createForm("a", `Flood form ${run}`);
  forms.ipA = await createForm("a", `IP form A ${run}`);
  forms.ipB = await createForm("a", `IP form B ${run}`);
  forms.b = await createForm("b", `B contact form ${run}`);
  forms.noEnt = await createForm("c", `No entitlement form ${run}`);
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("leads").delete().in("organisation_id", ids);
  await admin.from("webhook_forms").delete().in("organisation_id", ids);
  await admin.from("organisations").delete().in("id", ids);
  // The rate-limit ledger is keyed by token/IP strings, not by organisation,
  // so it is not removed by the cascade. Only this suite writes it locally.
  await admin.from("webhook_rate_limits").delete().in("scope", ["token", "ip"]);
});

async function leadsForForm(formId: string) {
  const { data, error } = await admin
    .from("leads")
    .select("*")
    .eq("webhook_form_id", formId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

test("a valid submission creates a mapped lead in the form's organisation", async ({
  request,
}) => {
  const payload = {
    name: "Jo Bloggs",
    email: `valid-${run}@example.com`,
    phone: "01234 567890",
    message: `Please quote for a hoist inspection ${run}`,
    swl_tonnes: "5", // an extra field a specialist form might send
    [HONEYPOT_FIELD]: "", // present but empty, as a real hidden field is
  };
  const response = await postLead(request, forms.active.token, payload);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });

  const { data: leads } = await admin
    .from("leads")
    .select("*")
    .eq("organisation_id", orgIds.a)
    .eq("email", `valid-${run}@example.com`);
  expect(leads?.length).toBe(1);
  const lead = leads![0];
  expect(lead.name).toBe("Jo Bloggs");
  expect(lead.phone).toBe("01234 567890");
  expect(lead.message).toBe(`Please quote for a hoist inspection ${run}`);
  expect(lead.source).toBe("website");
  expect(lead.status).toBe("new");
  expect(lead.webhook_form_id).toBe(forms.active.id);
  // The whole submission is kept verbatim, including fields we do not map.
  expect(lead.raw_payload.swl_tonnes).toBe("5");
  expect(lead.raw_payload.email).toBe(`valid-${run}@example.com`);
});

test("unknown token, disabled form and unentitled organisation all 404 with no lead", async ({
  request,
}) => {
  const body = { name: "Nobody", email: `void-${run}@example.com` };

  const unknown = await postLead(request, "z".repeat(48), body);
  expect(unknown.status()).toBe(404);

  const disabled = await postLead(request, forms.disabled.token, body);
  expect(disabled.status()).toBe(404);
  expect(await leadsForForm(forms.disabled.id)).toHaveLength(0);

  const noEnt = await postLead(request, forms.noEnt.token, body);
  expect(noEnt.status()).toBe(404);
  // Organisation C has no leads module, so nothing was ever created there.
  const { data: cLeads } = await admin
    .from("leads")
    .select("id")
    .eq("organisation_id", orgIds.c);
  expect(cLeads?.length).toBe(0);
});

test("a honeypot submission is stored as spam but still answers success", async ({
  request,
}) => {
  const response = await postLead(request, forms.active.token, {
    name: "Spam Bot",
    email: `bot-${run}@spam.test`,
    message: `caught ${run}`,
    [HONEYPOT_FIELD]: "http://bot-filled-this.example",
  });
  // Indistinguishable from a real success, so a bot learns nothing.
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });

  const { data: leads } = await admin
    .from("leads")
    .select("status, raw_payload")
    .eq("organisation_id", orgIds.a)
    .eq("email", `bot-${run}@spam.test`);
  expect(leads?.length).toBe(1);
  expect(leads![0].status).toBe("spam");
  // Nothing is lost: the honeypot value is still in the raw payload.
  expect(leads![0].raw_payload[HONEYPOT_FIELD]).toBe(
    "http://bot-filled-this.example"
  );
});

test("exceeding the per-token rate limit returns 429", async ({ request }) => {
  // Flood one token, each request from a distinct IP so only the token bucket
  // accumulates. The limiter increments atomically, so the outcome is by
  // count, not timing.
  const attempts = TOKEN_RATE_LIMIT + 2;
  const responses = await Promise.all(
    Array.from({ length: attempts }, (_, i) =>
      postLead(
        request,
        forms.flood.token,
        { message: `flood ${run} ${i}` },
        { ip: `198.51.100.${i + 1}` }
      )
    )
  );
  const statuses = responses.map((r) => r.status());
  const ok = statuses.filter((s) => s === 200).length;
  const tooMany = statuses.filter((s) => s === 429).length;
  expect(ok).toBeLessThanOrEqual(TOKEN_RATE_LIMIT);
  expect(tooMany).toBeGreaterThanOrEqual(1);
});

test("exceeding the per-IP rate limit returns 429", async ({ request }) => {
  // One IP, spread across two forms so neither token bucket reaches its own
  // limit; the IP bucket is what trips.
  const attempts = IP_RATE_LIMIT + 2;
  const ip = "203.0.113.50";
  const responses = await Promise.all(
    Array.from({ length: attempts }, (_, i) =>
      postLead(
        request,
        i % 2 === 0 ? forms.ipA.token : forms.ipB.token,
        { message: `ip flood ${run} ${i}` },
        { ip }
      )
    )
  );
  const statuses = responses.map((r) => r.status());
  expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
  // Neither token reached its own ceiling, so the 429s are the IP limit.
  expect(await leadsForForm(forms.ipA.id)).not.toHaveLength(0);
});

test("an oversized payload is rejected", async ({ request }) => {
  const huge = JSON.stringify({ message: `OVERSIZE-${run}-` + "x".repeat(20000) });
  const response = await postLead(request, forms.active.token, null, {
    raw: huge,
  });
  expect(response.status()).toBe(413);
  const { data: leads } = await admin
    .from("leads")
    .select("id")
    .eq("organisation_id", orgIds.a)
    .like("message", `OVERSIZE-${run}-%`);
  expect(leads?.length).toBe(0);
});

test("the token is the only key: a submission lands only in its own organisation", async ({
  request,
}) => {
  const marker = `only-in-b-${run}`;
  const response = await postLead(request, forms.b.token, {
    name: "B Lead",
    email: `b-${run}@example.com`,
    message: marker,
  });
  expect(response.status()).toBe(200);

  // The lead is in organisation B, linked to B's form.
  const { data: bLeads } = await admin
    .from("leads")
    .select("organisation_id, webhook_form_id")
    .eq("organisation_id", orgIds.b)
    .eq("message", marker);
  expect(bLeads?.length).toBe(1);
  expect(bLeads![0].webhook_form_id).toBe(forms.b.id);

  // And nowhere else: organisation A never saw it.
  const { data: aLeads } = await admin
    .from("leads")
    .select("id")
    .eq("organisation_id", orgIds.a)
    .eq("message", marker);
  expect(aLeads?.length).toBe(0);
});

test("a plain url-encoded form post creates a mapped lead with the raw payload kept", async ({
  request,
}) => {
  // A standard HTML form (no JavaScript) posting url-encoded.
  const response = await postForm(request, forms.active.token, {
    name: "Form Visitor",
    email: `urlenc-${run}@example.com`,
    phone: "07000 000000",
    message: `Plain HTML form ${run}`,
    company: "No-JS Co", // an extra field, kept but not mapped
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });

  const { data: leads } = await admin
    .from("leads")
    .select("*")
    .eq("organisation_id", orgIds.a)
    .eq("email", `urlenc-${run}@example.com`);
  expect(leads?.length).toBe(1);
  const lead = leads![0];
  expect(lead.name).toBe("Form Visitor");
  expect(lead.phone).toBe("07000 000000");
  expect(lead.message).toBe(`Plain HTML form ${run}`);
  expect(lead.source).toBe("website");
  expect(lead.status).toBe("new");
  expect(lead.webhook_form_id).toBe(forms.active.id);
  // The whole submission is kept verbatim, including the unmapped field.
  expect(lead.raw_payload.company).toBe("No-JS Co");
});

test("a JSON post still creates a mapped lead", async ({ request }) => {
  const response = await postLead(request, forms.active.token, {
    name: "JSON Visitor",
    email: `json-still-${run}@example.com`,
    message: `JSON path ${run}`,
  });
  expect(response.status()).toBe(200);
  const { data: leads } = await admin
    .from("leads")
    .select("name, source, status, webhook_form_id")
    .eq("organisation_id", orgIds.a)
    .eq("email", `json-still-${run}@example.com`);
  expect(leads?.length).toBe(1);
  expect(leads![0].name).toBe("JSON Visitor");
  expect(leads![0].source).toBe("website");
  expect(leads![0].status).toBe("new");
  expect(leads![0].webhook_form_id).toBe(forms.active.id);
});

test("the honeypot catches spam on the url-encoded path too", async ({
  request,
}) => {
  const response = await postForm(request, forms.active.token, {
    name: "Bot",
    email: `urlenc-spam-${run}@spam.test`,
    [HONEYPOT_FIELD]: "i am a bot",
  });
  // Same ordinary success, so the bot learns nothing.
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });

  const { data: leads } = await admin
    .from("leads")
    .select("status, raw_payload")
    .eq("organisation_id", orgIds.a)
    .eq("email", `urlenc-spam-${run}@spam.test`);
  expect(leads?.length).toBe(1);
  expect(leads![0].status).toBe("spam");
  expect(leads![0].raw_payload[HONEYPOT_FIELD]).toBe("i am a bot");
});

test("the plain HTML example uses exactly the fields the endpoint maps", async () => {
  const html = buildExampleFormHtml(
    "https://relay.example/api/lead-webhooks/example-token"
  );
  // No JavaScript needed: a real form post.
  expect(html).toContain('method="post"');
  expect(html).toContain(
    'action="https://relay.example/api/lead-webhooks/example-token"'
  );
  // Every mapped field has an input, and only those plus the honeypot.
  for (const field of MAPPED_FIELDS) {
    expect(html).toContain(`name="${field}"`);
  }
  expect(html).toContain(`name="${HONEYPOT_FIELD}"`);
  // The honeypot is genuinely hidden from real users.
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("left:-5000px");
});
