// Per-record notes section test for Pass 7B. Runs with:
// npm run test:notes-section
//
// Drives the notes section that now sits on the customer and quote detail
// pages. A write user sees the section newest-first, adds a note (linked to that
// record, not free-chosen), edits its body and deletes it behind the confirm. A
// read_only user sees the notes and their author but none of the controls.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `nsec-${run}`;
const emailFor = (label: string) => `${label}-${run}@notes-section.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgId: string;
let customerId: string;
let quoteId: string;
let writeUserId: string;
const userIds: string[] = [];
let planId: string;
const olderBody = `Older note ${run}`;
const newerBody = `Newer note ${run}`;

test.beforeAll(async () => {
  const org = await admin
    .from("organisations")
    .insert({ name: `Notes Section ${run}`, slug: slugA })
    .select("id")
    .single();
  if (org.error) throw new Error(org.error.message);
  orgId = org.data.id;

  // The detail pages live under the customers and quotes modules; notes are
  // gated by the record's module, so those two are all that is needed.
  const plan = await admin
    .from("plans")
    .insert({ key: `nsec-${run}`, name: "NSEC", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  for (const moduleKey of ["customers", "quotes"]) {
    const linked = await admin
      .from("plan_modules")
      .insert({ plan_id: planId, module: moduleKey });
    if (linked.error) throw new Error(linked.error.message);
  }
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgId,
    new_plan_id: planId,
  });
  if (assigned.error) throw new Error(assigned.error.message);

  for (const [label, role] of [
    ["write", "staff"],
    ["read", "read_only"],
  ] as const) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(label),
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    userIds.push(user.data.user.id);
    if (label === "write") writeUserId = user.data.user.id;
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgId,
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }

  const customer = await admin
    .from("customers")
    .insert({ organisation_id: orgId, name: `Section customer ${run}`, type: "business" })
    .select("id")
    .single();
  if (customer.error) throw new Error(customer.error.message);
  customerId = customer.data.id;

  const quote = await admin
    .from("quotes")
    .insert({
      organisation_id: orgId,
      customer_id: customerId,
      quote_number: 1,
      title: "Section quote",
      status: "draft",
    })
    .select("id")
    .single();
  if (quote.error) throw new Error(quote.error.message);
  quoteId = quote.data.id;

  // Two notes on the customer, inserted in separate statements so their
  // created_at differs and the newest-first order is well defined. Authored by
  // the write user, so the section shows an author name (the email fallback).
  const first = await admin.from("notes").insert({
    organisation_id: orgId,
    body: olderBody,
    related_type: "customer",
    related_id: customerId,
    created_by: writeUserId,
    updated_by: writeUserId,
  });
  if (first.error) throw new Error(first.error.message);
  const second = await admin.from("notes").insert({
    organisation_id: orgId,
    body: newerBody,
    related_type: "customer",
    related_id: customerId,
    created_by: writeUserId,
    updated_by: writeUserId,
  });
  if (second.error) throw new Error(second.error.message);
});

test.afterAll(async () => {
  // Quotes restrict customer deletion, so clear them before the org cascade.
  await admin.from("audit_log").delete().eq("organisation_id", orgId);
  await admin.from("quotes").delete().eq("organisation_id", orgId);
  await admin.from("organisations").delete().eq("id", orgId);
  await admin.from("plans").delete().eq("id", planId);
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailFor(label));
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/);
}

// The notes section, located by its heading, for scoping queries to it.
function notesSection(page: Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Notes", exact: true }),
  });
}

test("customer detail shows its notes section newest-first; a write user adds a note linked to the customer, edits its body and deletes it", async ({
  page,
}) => {
  await signIn(page, "write");
  const detail = `/app/${slugA}/customers/${customerId}`;
  await page.goto(detail);

  await expect(
    page.getByRole("heading", { name: "Notes", level: 2 })
  ).toBeVisible();

  // Newest first: the second-seeded note appears before the first.
  const items = notesSection(page).locator("ul > li");
  await expect(items.nth(0)).toContainText(newerBody);
  await expect(items.nth(1)).toContainText(olderBody);

  // Add a note from the section's add form.
  const body = `Added note ${run}`;
  const addForm = page.getByRole("form", { name: "Add note" });
  await addForm.getByLabel("Note").fill(body);
  await addForm.getByRole("button", { name: "Add note" }).click();

  // It redirects back to the customer and the note shows in the section, newest
  // first (so it is the first item).
  await expect(page).toHaveURL(new RegExp(`/customers/${customerId}$`));
  await expect(notesSection(page).locator("ul > li").nth(0)).toContainText(body);

  // Edit the note's body.
  const card = page.locator("li", { hasText: body });
  await card.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/editNote=/);
  const edited = `Edited note ${run}`;
  const editForm = page.getByRole("form", { name: "Edit note" });
  await editForm.getByLabel("Note").fill(edited);
  await editForm.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${customerId}$`));
  await expect(page.getByText(edited)).toBeVisible();

  // Delete behind the permanent-delete confirm.
  const editedCard = page.locator("li", { hasText: edited });
  await editedCard.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByText(edited)).toHaveCount(0);
});

test("quote detail shows its notes section; a write user adds a note linked to the quote", async ({
  page,
}) => {
  await signIn(page, "write");
  const detail = `/app/${slugA}/quotes/${quoteId}`;
  await page.goto(detail);
  await expect(
    page.getByRole("heading", { name: "Notes", level: 2 })
  ).toBeVisible();

  const body = `Quote note ${run}`;
  const addForm = page.getByRole("form", { name: "Add note" });
  await addForm.getByLabel("Note").fill(body);
  await addForm.getByRole("button", { name: "Add note" }).click();
  await expect(page).toHaveURL(new RegExp(`/quotes/${quoteId}$`));
  // It appears in the quote's section, which filters by the quote's related
  // pair, so its presence proves the note is linked to this quote.
  await expect(notesSection(page).getByText(body)).toBeVisible();
});

test("a read_only user sees the notes and their author but none of the controls", async ({
  page,
}) => {
  await signIn(page, "read");
  await page.goto(`/app/${slugA}/customers/${customerId}`);

  const section = notesSection(page);
  await expect(
    page.getByRole("heading", { name: "Notes", level: 2 })
  ).toBeVisible();
  // The seeded notes and their author (the write user's email, read through the
  // co-member-visible read) are shown.
  await expect(section.getByText(olderBody)).toBeVisible();
  // Both seeded notes are by the write user, so the author appears more than
  // once; the first is enough to prove the co-member author read works.
  await expect(section.getByText(emailFor("write")).first()).toBeVisible();

  // None of the write controls.
  await expect(page.getByRole("form", { name: "Add note" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add note" })).toHaveCount(0);
  await expect(section.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Delete" })).toHaveCount(0);
});
