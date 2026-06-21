// Demo seed for looking at the app by hand. Runs with: npm run seed:demo
//
// Creates persistent demo data against the local stack: one organisation,
// one client_admin user, a leads entitlement via a real assign_plan call,
// and six sample leads across every status. Safe to re-run: existing demo
// data (identified by the fixed slug, plan key and email below) is removed
// first, then recreated. Deliberately separate from the test suites, which
// use random run-suffixed slugs and clean up after themselves.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run seed:demo (reads .env.local)"
  );
  process.exit(1);
}

const DEMO_ORG_NAME = "Kestrel Lifting Services";
const DEMO_ORG_SLUG = "kestrel-lifting";
const DEMO_PLAN_KEY = "demo-core";
const DEMO_EMAIL = "demo@kestrellifting.co.uk";
const DEMO_PASSWORD = "KestrelDemo2026!";
// A second active member, so the scheduler's assignee filter and the per-job
// assignee column read against real, distinct names (the demo admin plus a field
// engineer). Local demo only; it shares the demo password but is mainly there as
// an assignee, not a login.
const DEMO_ENGINEER_EMAIL = "ravi@kestrellifting.co.uk";
const DEMO_ENGINEER_NAME = "Ravi Mistry";
// A fixed public token on the sent demo quote, so the customer-facing page
// at /q/<token> can be opened by hand. Local demo only; real tokens are 32
// random bytes minted by the send transition.
const DEMO_PREVIEW_TOKEN = "demo-preview-token-0123456789abcdefghij";
// A fixed token on a demo web form, so the public lead-intake endpoint at
// /api/lead-webhooks/<token> can be posted to by hand and the lead watched
// landing in the Leads list. Local demo only; real tokens are 32 random
// bytes from the database default or a regenerate.
const DEMO_FORM_TOKEN = "demo-web-form-token-0123456789abcdefghij";

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function fail(step: string, message: string): never {
  console.error(`SEED FAILED at ${step}: ${message}`);
  process.exit(1);
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// This week's Monday at 00:00 UTC. Mirrors the Monday-start, UTC week the
// scheduler view computes (lib/jobs/week.ts), so jobs anchored to it land in the
// current week whatever weekday the seed runs, giving the week view real data.
function thisMonday() {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const day = midnight.getUTCDay();
  const backToMonday = day === 0 ? 6 : day - 1;
  return midnight.getTime() - backToMonday * 86_400_000;
}

// A clean UTC instant on a weekday of the current week (0 = Mon .. 6 = Sun) at
// "HH:MM", as the scheduler stores and displays times.
function weekdayAt(dayOffset: number, time: string) {
  const [h, m] = time.split(":").map(Number);
  return new Date(
    thisMonday() + dayOffset * 86_400_000 + (h * 60 + m) * 60_000
  ).toISOString();
}

// 1. Clear any previous demo data.
const existingOrg = await admin
  .from("organisations")
  .select("id")
  .eq("slug", DEMO_ORG_SLUG)
  .maybeSingle();
if (existingOrg.data) {
  await admin
    .from("audit_log")
    .delete()
    .eq("organisation_id", existingOrg.data.id);
  // The organisation delete cascades the files rows but not their stored
  // objects, so remove those first to keep storage tidy on a reseed.
  const existingFiles = await admin
    .from("files")
    .select("storage_path")
    .eq("organisation_id", existingOrg.data.id);
  const existingPaths = (existingFiles.data ?? []).map((f) => f.storage_path);
  if (existingPaths.length) {
    await admin.storage.from("attachments").remove(existingPaths);
  }
  // The logo lives in the public 'logos' bucket under the org's folder; the org
  // delete does not cascade storage objects, so remove them on a reseed too.
  const existingLogos = await admin.storage
    .from("logos")
    .list(existingOrg.data.id);
  const logoPaths = (existingLogos.data ?? []).map(
    (o) => `${existingOrg.data!.id}/${o.name}`
  );
  if (logoPaths.length) {
    await admin.storage.from("logos").remove(logoPaths);
  }
  // Quotes restrict customer deletion, so remove them before the cascade.
  await admin
    .from("quotes")
    .delete()
    .eq("organisation_id", existingOrg.data.id);
  const removed = await admin
    .from("organisations")
    .delete()
    .eq("id", existingOrg.data.id);
  if (removed.error) fail("clear organisation", removed.error.message);
}
await admin.from("plans").delete().eq("key", DEMO_PLAN_KEY);
for (const email of [DEMO_EMAIL, DEMO_ENGINEER_EMAIL]) {
  const existingUser = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingUser.data) {
    const removed = await admin.auth.admin.deleteUser(existingUser.data.id);
    if (removed.error) fail("clear user", removed.error.message);
  }
}

// 2. Recreate it all.
const org = await admin
  .from("organisations")
  .insert({
    name: DEMO_ORG_NAME,
    slug: DEMO_ORG_SLUG,
    // The design system reads the workspace brand colour into --brand; seeding
    // the calm default makes the demo exercise the per-workspace accent path.
    brand_color: "#5b5bd6",
  })
  .select("id")
  .single();
if (org.error) fail("create organisation", org.error.message);
const demoOrgId = org.data.id;

// The logo is a raster (PNG) in the public 'logos' bucket, so the whole path is
// demonstrable: it shows in the shell and on the public quote page, and embeds
// in the quote PDF (pdf-lib takes raster, not SVG). Upload it under the org's
// folder and store the resulting public URL, exactly as the admin upload action
// does. The PNG is committed (generated from the SVG mark).
const logoBytes = readFileSync("public/demo/kestrel-logo.png");
const logoPath = `${demoOrgId}/logo-${crypto.randomUUID()}.png`;
const logoUpload = await admin.storage
  .from("logos")
  .upload(logoPath, logoBytes, { contentType: "image/png" });
if (logoUpload.error) fail("upload demo logo", logoUpload.error.message);
const demoLogoUrl = admin.storage.from("logos").getPublicUrl(logoPath).data
  .publicUrl;
const logoSet = await admin
  .from("organisations")
  .update({ logo_url: demoLogoUrl })
  .eq("id", demoOrgId);
if (logoSet.error) fail("set demo logo_url", logoSet.error.message);

const user = await admin.auth.admin.createUser({
  email: DEMO_EMAIL,
  password: DEMO_PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: "Demo Admin" },
});
if (user.error || !user.data.user) {
  fail("create user", user.error?.message ?? "no user returned");
}

const membership = await admin.from("organisation_memberships").insert({
  organisation_id: org.data.id,
  user_id: user.data.user.id,
  role: "client_admin",
  status: "active",
});
if (membership.error) fail("create membership", membership.error.message);

// The field engineer: a second active member (staff role, a record writer) so
// the scheduler can spread jobs across two named assignees.
const engineer = await admin.auth.admin.createUser({
  email: DEMO_ENGINEER_EMAIL,
  password: DEMO_PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: DEMO_ENGINEER_NAME },
});
if (engineer.error || !engineer.data.user) {
  fail("create engineer user", engineer.error?.message ?? "no user returned");
}
const demoEngineerId = engineer.data.user.id;
const engineerMembership = await admin
  .from("organisation_memberships")
  .insert({
    organisation_id: org.data.id,
    user_id: demoEngineerId,
    role: "staff",
    status: "active",
  });
if (engineerMembership.error) {
  fail("create engineer membership", engineerMembership.error.message);
}

const plan = await admin
  .from("plans")
  .insert({
    key: DEMO_PLAN_KEY,
    name: "Demo Core",
    description: "Demo plan for local viewing",
    monthly_price_pence: 14900,
  })
  .select("id")
  .single();
if (plan.error) fail("create plan", plan.error.message);
// The demo plan entitles every built module, so the demo workspace showcases the
// whole product: the seeded templates, automations and file all appear, and the
// dashboard has every card to show. (files is built:false so it has no sidebar
// entry, but its entitlement gates the per-record file actions on the seeded
// welcome.txt.)
const linked = await admin.from("plan_modules").insert([
  { plan_id: plan.data.id, module: "leads" },
  { plan_id: plan.data.id, module: "customers" },
  { plan_id: plan.data.id, module: "quotes" },
  { plan_id: plan.data.id, module: "tasks" },
  { plan_id: plan.data.id, module: "jobs" },
  { plan_id: plan.data.id, module: "templates" },
  { plan_id: plan.data.id, module: "automations" },
  { plan_id: plan.data.id, module: "files" },
  { plan_id: plan.data.id, module: "subscription_savings" },
]);
if (linked.error) fail("link plan modules", linked.error.message);
const assigned = await admin.rpc("assign_plan", {
  org_id: org.data.id,
  new_plan_id: plan.data.id,
});
if (assigned.error) fail("assign plan", assigned.error.message);

const leads = await admin.from("leads").insert([
  {
    organisation_id: org.data.id,
    name: "Dave Holloway",
    email: "dave.holloway@harbourmarine.co.uk",
    phone: "07700 900123",
    message:
      "We need a LOLER inspection on two overhead cranes at our Chatham yard. Could someone call me this week?",
    source: "website",
    status: "new",
    created_at: daysAgo(0),
  },
  {
    organisation_id: org.data.id,
    name: "Priya Nair",
    email: "p.nair@medwayfabrications.co.uk",
    phone: "07700 900456",
    message:
      "Looking for a quote on replacement chain slings, 2 tonne working load, ideally delivered by month end.",
    source: "website",
    status: "contacted",
    created_at: daysAgo(2),
  },
  {
    organisation_id: org.data.id,
    name: "Tom Askew",
    email: "tom@askewscaffolding.co.uk",
    phone: "07700 900789",
    message:
      "Interested in an annual inspection contract covering hoists across our three Kent sites.",
    source: "referral",
    status: "qualified",
    created_at: daysAgo(4),
  },
  {
    organisation_id: org.data.id,
    name: "Sandra Mills",
    email: "s.mills@kentcontainers.co.uk",
    phone: "07700 900321",
    message: "Gantry crane servicing at our Sittingbourne depot.",
    source: "phone",
    status: "converted",
    created_at: daysAgo(7),
  },
  {
    organisation_id: org.data.id,
    name: "Gary Pratt",
    email: "gary.pratt@example.co.uk",
    phone: "07700 900654",
    message: "Do you do weekend forklift hire? Need one for a house move.",
    source: "website",
    status: "rejected",
    created_at: daysAgo(9),
  },
  {
    organisation_id: org.data.id,
    name: "Crypto Growth Partners",
    email: "winbig@example.com",
    message:
      "Grow your business 1000 percent with our exclusive marketing system. Reply now.",
    source: "website",
    status: "spam",
    created_at: daysAgo(11),
  },
]);
if (leads.error) fail("create leads", leads.error.message);

// One active web form with a fixed token, so the public lead intake can be
// demonstrated by hand: post to its submission URL and watch the lead appear
// in the Leads list.
const webForm = await admin.from("webhook_forms").insert({
  organisation_id: demoOrgId,
  name: "Website contact form",
  token: DEMO_FORM_TOKEN,
  status: "active",
});
if (webForm.error) fail("create web form", webForm.error.message);

const customers = await admin.from("customers").insert([
  {
    organisation_id: org.data.id,
    name: "Harbour Marine Engineering Ltd",
    type: "business",
    email: "office@harbourmarine.co.uk",
    phone: "07700 900201",
    address_line1: "Unit 4, Dockside Industrial Estate",
    town: "Chatham",
    county: "Kent",
    postcode: "ME4 4SW",
  },
  {
    organisation_id: org.data.id,
    name: "Medway Fabrications Ltd",
    type: "business",
    email: "accounts@medwayfabrications.co.uk",
    phone: "07700 900202",
    address_line1: "12 Foundry Lane",
    town: "Rochester",
    county: "Kent",
    postcode: "ME1 2DJ",
  },
  {
    organisation_id: org.data.id,
    name: "Kent Containers Ltd",
    type: "business",
    email: "depot@kentcontainers.co.uk",
    phone: "07700 900203",
    address_line1: "Sittingbourne Depot, Crown Quay Lane",
    town: "Sittingbourne",
    county: "Kent",
    postcode: "ME10 3HL",
  },
  {
    organisation_id: org.data.id,
    name: "Askew Scaffolding Services",
    type: "business",
    email: "tom@askewscaffolding.co.uk",
    phone: "07700 900204",
    address_line1: "Yard 2, Detling Hill",
    town: "Maidstone",
    county: "Kent",
    postcode: "ME14 3HT",
  },
  {
    organisation_id: org.data.id,
    name: "Sandra Mills",
    type: "individual",
    email: "s.mills@example.co.uk",
    phone: "07700 900205",
    address_line1: "8 Orchard Close",
    town: "Faversham",
    county: "Kent",
    postcode: "ME13 8QT",
  },
  {
    organisation_id: org.data.id,
    name: "Derek Wainwright",
    type: "individual",
    email: "derek.wainwright@example.co.uk",
    phone: "07700 900206",
    address_line1: "23 Mill Road",
    town: "Whitstable",
    county: "Kent",
    postcode: "CT5 1NR",
  },
]);
if (customers.error) fail("create customers", customers.error.message);

// Sample quotes with mixed VAT rates so totals are visible and varied. The
// totals columns are filled by the database triggers as lines insert.
// Quote numbers are seeded explicitly, so the counter is bumped past them
// to keep future allocations collision-free.
const customerIdByName = new Map<string, string>();
const seededCustomers = await admin
  .from("customers")
  .select("id, name")
  .eq("organisation_id", demoOrgId);
for (const row of seededCustomers.data ?? []) {
  customerIdByName.set(row.name, row.id);
}

// A few customers get contacts (one marked primary) and a site or two, so the
// customer detail page is populated. Re-run safe: the organisation reset above
// cascades these away before they are recreated.
const customerId = (name: string) => {
  const id = customerIdByName.get(name);
  if (!id) fail("seed contacts/sites", `customer ${name} not found`);
  return id;
};
const harbour = customerId("Harbour Marine Engineering Ltd");
const medway = customerId("Medway Fabrications Ltd");
const kent = customerId("Kent Containers Ltd");

const demoContacts = await admin.from("contacts").insert([
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    name: "Dave Holloway",
    job_title: "Yard Manager",
    email: "dave.holloway@harbourmarine.co.uk",
    phone: "07700 900123",
    is_primary: true,
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    name: "Ruth Carey",
    job_title: "Accounts",
    email: "accounts@harbourmarine.co.uk",
    phone: "07700 900133",
    is_primary: false,
  },
  {
    organisation_id: demoOrgId,
    customer_id: medway,
    name: "Priya Nair",
    job_title: "Operations Director",
    email: "p.nair@medwayfabrications.co.uk",
    phone: "07700 900456",
    is_primary: true,
  },
  {
    organisation_id: demoOrgId,
    customer_id: kent,
    name: "Sandra Mills",
    job_title: "Depot Supervisor",
    email: "s.mills@kentcontainers.co.uk",
    phone: "07700 900321",
    is_primary: true,
  },
]);
if (demoContacts.error) fail("create contacts", demoContacts.error.message);

const demoSites = await admin.from("sites").insert([
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    name: "Chatham yard",
    address_line1: "Unit 4, Dockside Industrial Estate",
    town: "Chatham",
    county: "Kent",
    postcode: "ME4 4SW",
    access_notes: "Report to the gatehouse for a hi-vis and induction.",
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    name: "Gillingham slipway",
    address_line1: "Pier Approach Road",
    town: "Gillingham",
    county: "Kent",
    postcode: "ME7 1RX",
  },
  {
    organisation_id: demoOrgId,
    customer_id: kent,
    name: "Sittingbourne depot",
    address_line1: "Crown Quay Lane",
    town: "Sittingbourne",
    county: "Kent",
    postcode: "ME10 3HL",
    access_notes: "Forklift access via the rear gate only.",
  },
]).select("id, name");
if (demoSites.error) fail("create sites", demoSites.error.message);
const siteIdByName = new Map<string, string>();
for (const site of demoSites.data ?? []) {
  siteIdByName.set(site.name, site.id);
}

// Captures each seeded quote's id by number, so a demo task can link to one.
const quoteIdByNumber = new Map<number, string>();

async function seedQuote(
  quoteNumber: number,
  customerName: string,
  title: string,
  status: string,
  issuedDaysAgo: number | null,
  lines: Array<{
    description: string;
    quantity: number;
    unit_price_pence: number;
    vat_rate: number;
  }>,
  publicToken: string | null = null,
  siteId: string | null = null
) {
  const customerId = customerIdByName.get(customerName);
  if (!customerId) fail("seed quote", `customer ${customerName} not found`);
  const quote = await admin
    .from("quotes")
    .insert({
      organisation_id: demoOrgId,
      customer_id: customerId,
      quote_number: quoteNumber,
      title,
      status,
      issued_at: issuedDaysAgo === null ? null : daysAgo(issuedDaysAgo),
      valid_until: "2026-07-31",
      public_token: publicToken,
      site_id: siteId,
    })
    .select("id")
    .single();
  if (quote.error) fail(`seed quote ${quoteNumber}`, quote.error.message);
  quoteIdByNumber.set(quoteNumber, quote.data.id);
  const inserted = await admin.from("quote_line_items").insert(
    lines.map((line, index) => ({
      organisation_id: demoOrgId,
      quote_id: quote.data.id,
      position: index + 1,
      ...line,
    }))
  );
  if (inserted.error) fail(`seed lines ${quoteNumber}`, inserted.error.message);
}

await seedQuote(
  1,
  "Harbour Marine Engineering Ltd",
  "LOLER inspections, Chatham yard",
  "sent",
  3,
  [
    {
      description: "LOLER thorough examination, overhead crane",
      quantity: 2,
      unit_price_pence: 18500,
      vat_rate: 20,
    },
    {
      description: "Access equipment and travel",
      quantity: 1,
      unit_price_pence: 4500,
      vat_rate: 20,
    },
    {
      description: "Inspection report pack",
      quantity: 1,
      unit_price_pence: 2500,
      vat_rate: 0,
    },
  ],
  DEMO_PREVIEW_TOKEN,
  // Link the sent demo quote to the customer's Chatham yard site, so the site
  // shows on the detail, public page and PDF end to end.
  siteIdByName.get("Chatham yard") ?? null
);
await seedQuote(
  2,
  "Medway Fabrications Ltd",
  "Chain sling replacements",
  "draft",
  null,
  [
    {
      description: "Chain sling, 2 tonne, replacement",
      quantity: 4,
      unit_price_pence: 8999,
      vat_rate: 20,
    },
    {
      description: "Safety labels and tags",
      quantity: 10,
      unit_price_pence: 250,
      vat_rate: 5,
    },
  ]
);
await seedQuote(
  3,
  "Kent Containers Ltd",
  "Annual gantry crane service",
  "accepted",
  10,
  [
    {
      description: "Annual service contract, gantry crane",
      quantity: 1,
      unit_price_pence: 120000,
      vat_rate: 20,
    },
  ]
);

const counter = await admin
  .from("organisations")
  .update({ next_quote_number: 4 })
  .eq("id", demoOrgId);
if (counter.error) fail("bump quote counter", counter.error.message);

// A spread of tasks: varied statuses, a couple assigned to the demo user, one
// past its due date so the overdue flag shows, and a couple with no assignee.
// Two are linked to records (a customer and a quote) so the per-record sections
// and the linked badge on the list show real data. Re-run safe: the linked ids
// come from the records just recreated above, and the organisation reset
// cascades these tasks away before they are recreated.
const demoUserId = user.data.user.id;
const medwayQuoteId = quoteIdByNumber.get(2);
if (!medwayQuoteId) fail("seed tasks", "Medway quote (#2) not found");
const demoTasks = await admin.from("tasks").insert([
  {
    organisation_id: demoOrgId,
    title: "Chase Harbour Marine for LOLER access dates",
    description: "Confirm gatehouse induction times before the Chatham visit.",
    status: "open",
    due_at: daysAgo(-2),
    assigned_to: demoUserId,
    related_type: "customer",
    related_id: harbour,
  },
  {
    organisation_id: demoOrgId,
    title: "Book the Kent Containers gantry service slot",
    description: "Annual service accepted; schedule with the depot.",
    status: "in_progress",
    due_at: daysAgo(-5),
    assigned_to: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    title: "Send Medway the revised chain sling quote",
    description: "They asked for delivery by month end.",
    status: "open",
    due_at: daysAgo(1),
    assigned_to: null,
    related_type: "quote",
    related_id: medwayQuoteId,
  },
  {
    organisation_id: demoOrgId,
    title: "Order replacement safety tags and labels",
    status: "open",
    due_at: null,
    assigned_to: null,
  },
  {
    organisation_id: demoOrgId,
    title: "File the 2025 inspection certificates",
    status: "done",
    due_at: daysAgo(10),
    assigned_to: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    title: "Follow up the lapsed Sittingbourne enquiry",
    status: "cancelled",
    due_at: null,
    assigned_to: null,
  },
]);
if (demoTasks.error) fail("create tasks", demoTasks.error.message);

// A spread of jobs across the statuses: one still unscheduled, scheduled and
// in-progress jobs (a couple assigned to the demo user), a completed and a
// cancelled one, and one created from quote #1 so the originating-quote link and
// the create-from-quote path show real data. On top of that, a clutch of jobs
// anchored into the current week (weekdayAt), split across the two members and
// one unassigned, so the scheduler week view has a genuinely busy week to show
// and the assignee filter has something to filter. Re-run safe: the customer,
// site and quote ids come from the records recreated above, and the organisation
// reset cascades these jobs away before they are recreated.
const chathamYardId = siteIdByName.get("Chatham yard") ?? null;
const harbourQuoteId = quoteIdByNumber.get(1) ?? null;
const demoJobs = await admin.from("jobs").insert([
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    site_id: chathamYardId,
    quote_id: harbourQuoteId,
    title: "LOLER inspection, Chatham yard cranes",
    description: "Two overhead cranes; gatehouse induction required on arrival.",
    status: "scheduled",
    scheduled_start: daysAgo(-3),
    assigned_to: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    site_id: chathamYardId,
    title: "Replace worn chain sling",
    status: "in_progress",
    scheduled_start: daysAgo(0),
    assigned_to: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    title: "Quote site survey",
    description: "Measure up before quoting the gantry refurbishment.",
    status: "unscheduled",
    scheduled_start: null,
    assigned_to: null,
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    site_id: chathamYardId,
    title: "Annual gantry service",
    status: "completed",
    scheduled_start: daysAgo(14),
    assigned_to: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    title: "Emergency hoist callout",
    description: "Customer resolved it themselves before the visit.",
    status: "cancelled",
    scheduled_start: daysAgo(7),
    assigned_to: null,
  },
  // The current week, Mon to Fri, across both members and one unassigned.
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    site_id: chathamYardId,
    title: "LOLER inspection, harbour cranes",
    status: "scheduled",
    scheduled_start: weekdayAt(0, "08:30"),
    assigned_to: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    site_id: chathamYardId,
    title: "Sling load test, bay 3",
    status: "scheduled",
    scheduled_start: weekdayAt(0, "13:00"),
    assigned_to: demoEngineerId,
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    title: "Replace lifting eye bolts",
    status: "scheduled",
    scheduled_start: weekdayAt(1, "09:00"),
    assigned_to: demoEngineerId,
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    site_id: chathamYardId,
    title: "Overhead crane service",
    status: "in_progress",
    scheduled_start: weekdayAt(2, "10:30"),
    assigned_to: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    title: "Site survey, new gantry line",
    status: "scheduled",
    scheduled_start: weekdayAt(3, "11:00"),
    assigned_to: null,
  },
  {
    organisation_id: demoOrgId,
    customer_id: harbour,
    site_id: chathamYardId,
    title: "Chain hoist annual inspection",
    status: "scheduled",
    scheduled_start: weekdayAt(4, "14:00"),
    assigned_to: demoEngineerId,
  },
]);
if (demoJobs.error) fail("create jobs", demoJobs.error.message);

// A recurring series, so the scheduler, list and detail show recurrence and its
// indicator: a weekly site safety check anchored on this week's Monday at 07:30,
// with six occurrences stamped from this week forward (the shape the recurrence
// actions generate). Re-run safe via the organisation reset cascade (job_series
// and jobs are org-scoped ON DELETE CASCADE).
const recurringAnchorMs = thisMonday() + (7 * 60 + 30) * 60_000; // Mon 07:30
const recurringSeries = await admin
  .from("job_series")
  .insert({
    organisation_id: demoOrgId,
    frequency: "weekly",
    repeat_interval: 1,
    anchor_start: new Date(recurringAnchorMs).toISOString(),
    title: "Weekly site safety check",
    description: "Routine weekly inspection of the yard.",
    customer_id: harbour,
    site_id: chathamYardId,
    assigned_to: demoEngineerId,
    generated_until: new Date(recurringAnchorMs + 92 * 86_400_000).toISOString(),
  })
  .select("id")
  .single();
if (recurringSeries.error) fail("create job series", recurringSeries.error.message);
const recurringOccurrences = Array.from({ length: 6 }, (_, k) => {
  const slot = new Date(recurringAnchorMs + k * 7 * 86_400_000).toISOString();
  return {
    organisation_id: demoOrgId,
    customer_id: harbour,
    site_id: chathamYardId,
    title: "Weekly site safety check",
    description: "Routine weekly inspection of the yard.",
    status: "scheduled",
    scheduled_start: slot,
    series_id: recurringSeries.data.id,
    series_slot: slot,
    assigned_to: demoEngineerId,
  };
});
const recurringJobs = await admin.from("jobs").insert(recurringOccurrences);
if (recurringJobs.error) fail("create recurring jobs", recurringJobs.error.message);

// A couple of notes attached to records, so the per-record notes sections show
// real data. Re-run safe: the linked ids come from the records recreated above,
// and the organisation reset cascades these notes away before they are recreated.
const demoNotes = await admin.from("notes").insert([
  {
    organisation_id: demoOrgId,
    body: "Spoke with Dave on site. Access is via the gatehouse, allow 15 minutes for the hi-vis induction before the crane examination.",
    related_type: "customer",
    related_id: harbour,
    created_by: demoUserId,
    updated_by: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    body: "Customer wants delivery before month end. Confirm stock on the 2 tonne slings before sending this quote.",
    related_type: "quote",
    related_id: medwayQuoteId,
    created_by: demoUserId,
    updated_by: demoUserId,
  },
]);
if (demoNotes.error) fail("create notes", demoNotes.error.message);

// One small file attached to a customer, so the per-record files section shows
// real data with a working download. Re-run safe: the previous demo
// organisation's stored objects are removed in the reset above, and the
// organisation reset cascades this file's row away before it is recreated.
const demoFileBody =
  "Welcome to BSK View.\n\nThis is a sample attachment so the files section on a record shows a real, downloadable file.\n";
const demoFilePath = `${demoOrgId}/customer/${harbour}/${crypto.randomUUID()}-welcome.txt`;
const demoFileUpload = await admin.storage
  .from("attachments")
  .upload(demoFilePath, new Blob([demoFileBody], { type: "text/plain" }), {
    contentType: "text/plain",
  });
if (demoFileUpload.error) fail("upload demo file", demoFileUpload.error.message);
const demoFile = await admin.from("files").insert({
  organisation_id: demoOrgId,
  related_type: "customer",
  related_id: harbour,
  filename: "welcome.txt",
  storage_path: demoFilePath,
  size_bytes: Buffer.byteLength(demoFileBody, "utf8"),
  mime_type: "text/plain",
  created_by: demoUserId,
  updated_by: demoUserId,
});
if (demoFile.error) fail("create demo file", demoFile.error.message);

// A couple of message templates using real catalogue tokens, so the templates
// screen and its live preview show real content. Re-run safe: the organisation
// reset cascades these away before they are recreated.
const demoTemplates = await admin.from("templates").insert([
  {
    organisation_id: demoOrgId,
    name: "Quote sent",
    category: "quote_sent",
    subject: "Your quote {{quote_number}} from {{organisation_name}}",
    body: "Hi {{contact_name}},\n\nThanks for your enquiry. Your quote {{quote_number}} comes to {{quote_total}} and is valid until {{valid_until}}.\n\nYou can view and accept it here: {{quote_link}}\n\nKind regards,\n{{organisation_name}}",
    created_by: demoUserId,
    updated_by: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    name: "Lead acknowledgement",
    category: "lead_acknowledgement",
    subject: "Thanks for getting in touch",
    body: "Hi {{contact_name}},\n\nThanks for contacting {{organisation_name}}. We have received your enquiry and will be in touch shortly.\n\nKind regards,\n{{organisation_name}}",
    created_by: demoUserId,
    updated_by: demoUserId,
  },
]);
if (demoTemplates.error) fail("create templates", demoTemplates.error.message);

// Enable the lead follow-up and quote accepted automations for the demo
// workspace with sensible configurations, so the automations screen shows active,
// configured automations. Re-run safe: the organisation reset cascades
// org_automations away before it is recreated.
const demoAutomation = await admin.from("org_automations").insert([
  {
    organisation_id: demoOrgId,
    automation_type: "lead_followup_task",
    enabled: true,
    config: {
      task_title: "Follow up with the new lead",
      days_until_due: 2,
      assignee_id: demoUserId,
    },
    created_by: demoUserId,
    updated_by: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    automation_type: "quote_accepted_task",
    enabled: true,
    config: {
      task_title: "Prepare the job for the accepted quote",
      days_until_due: 3,
      assignee_id: demoUserId,
    },
    created_by: demoUserId,
    updated_by: demoUserId,
  },
]);
if (demoAutomation.error) fail("create automation", demoAutomation.error.message);

// A few cancelled-subscription savings items, a mix of monthly and annual, so
// the savings widget shows a real total (about £81.99 a month and £983.88 a
// year, totalled live by the action from these pence). Re-run safe: the
// organisation reset cascades savings_items away before they are recreated.
const demoSavings = await admin.from("savings_items").insert([
  {
    organisation_id: demoOrgId,
    label: "Old CRM",
    amount_pence: 4900,
    cadence: "monthly",
    note: "Replaced by BSK View, so no longer needed.",
    cancelled_on: "2026-03-01",
    created_by: demoUserId,
    updated_by: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    label: "Email marketing tool",
    amount_pence: 18000,
    cadence: "annual",
    note: "Billed yearly; switched to a free tier.",
    cancelled_on: "2026-02-14",
    created_by: demoUserId,
    updated_by: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    label: "Stock photo subscription",
    amount_pence: 1299,
    cadence: "monthly",
    created_by: demoUserId,
    updated_by: demoUserId,
  },
  {
    organisation_id: demoOrgId,
    label: "Accounting add-on",
    amount_pence: 6000,
    cadence: "annual",
    created_by: demoUserId,
    updated_by: demoUserId,
  },
]);
if (demoSavings.error) fail("create savings items", demoSavings.error.message);

console.log("Demo data seeded.");
console.log("");
console.log(`  Organisation: ${DEMO_ORG_NAME} (/app/${DEMO_ORG_SLUG})`);
console.log("  Leads:        6, one per status");
console.log("  Customers:    6, four business and two individual");
console.log("  Contacts:     4 across 3 customers (one primary each)");
console.log("  Sites:        3 across 2 customers");
console.log("  Quotes:       3 (sent, draft, accepted) with mixed VAT lines");
console.log(
  "  Tasks:        6 across every status, one overdue, two assigned, two linked"
);
console.log("  Notes:        2 (one on a customer, one on a quote)");
console.log("  Files:        1 (welcome.txt on a customer)");
console.log("  Templates:    2 (quote-sent and lead-acknowledgement)");
console.log(
  "  Automations:  lead follow-up and quote accepted tasks enabled and configured"
);
console.log(
  "  Savings:      4 cancelled subscriptions (mixed monthly and annual)"
);
console.log("  Web form:     1 active (Website contact form)");
console.log("");
console.log("  Login URL:    http://localhost:3000/login");
console.log(`  Email:        ${DEMO_EMAIL}`);
console.log(`  Password:     ${DEMO_PASSWORD}`);
console.log("");
console.log("  Public quote (no login, the sent quote #1):");
console.log(`  http://localhost:3000/q/${DEMO_PREVIEW_TOKEN}`);
console.log("");
console.log("  Web form submission URL (POST JSON, no login):");
console.log(`  http://localhost:3000/api/lead-webhooks/${DEMO_FORM_TOKEN}`);
console.log("");
console.log("Start the app with npm run dev if it is not already running.");
