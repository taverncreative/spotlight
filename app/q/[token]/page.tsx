import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { PublicQuoteActions } from "@/components/public-quote-actions";
import { buttonVariants } from "@/components/ui/button";
import {
  brandForegroundColor,
  brandTextColor,
  resolveBrandColor,
} from "@/lib/brand";
import { formatPence } from "@/lib/currency";
import { siteAddressSummary, type QuoteSite } from "@/lib/quotes/site-summary";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicTransitionFormAction } from "./actions";

// The customer-facing quote page. No auth: the token is the only key, and the
// read goes through the service role scoped by it (the second sanctioned
// service-role surface). Draft, deleted or unknown tokens get a generic 404
// revealing nothing.
//
// It presents as the client's own light, branded document (Design Pass 4): the
// client organisation's logo and name, its brand_color as a sparing accent with
// contrast-safe text, and no BSK View branding. It is always light regardless of
// the app's dark default; the .q-light scope is established by app/q/layout.tsx.

export const dynamic = "force-dynamic";

type PublicCustomer = {
  name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
};

type PublicQuote = {
  id: string;
  quote_number: number;
  title: string | null;
  status: string;
  issued_at: string | null;
  valid_until: string | null;
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  first_viewed_at: string | null;
  updated_at: string;
  organisations: { name: string; brand_color: string | null; logo_url: string | null } | null;
  customers: PublicCustomer | null;
  sites: QuoteSite | null;
  quote_line_items: {
    id: string;
    position: number;
    description: string;
    quantity: number;
    unit_price_pence: number;
    vat_rate: number;
    line_total_pence: number;
  }[];
};

const PUBLIC_STATUSES = ["sent", "accepted", "declined", "expired"];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// A customer's address as a single comma-separated line, the same shape as a
// site address (lib/quotes/site-summary) but read from the customer record.
function customerAddress(customer: PublicCustomer): string {
  return [
    customer.address_line1,
    customer.address_line2,
    customer.town,
    customer.county,
    customer.postcode,
  ]
    .filter(Boolean)
    .join(", ");
}

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) {
    notFound();
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("quotes")
    .select(
      "id, quote_number, title, status, issued_at, valid_until, subtotal_pence, vat_pence, total_pence, first_viewed_at, updated_at, organisations (name, brand_color, logo_url), customers (name, email, phone, address_line1, address_line2, town, county, postcode), sites (name, address_line1, address_line2, town, county, postcode), quote_line_items (id, position, description, quantity, unit_price_pence, vat_rate, line_total_pence)"
    )
    .eq("public_token", token)
    .is("deleted_at", null)
    .in("status", PUBLIC_STATUSES)
    .order("position", { referencedTable: "quote_line_items", ascending: true })
    .maybeSingle();

  const quote = data as unknown as PublicQuote | null;
  if (!quote) {
    notFound();
  }

  // First public view of a sent quote, recorded once and never overwritten.
  if (quote.status === "sent" && !quote.first_viewed_at) {
    await admin
      .from("quotes")
      .update({ first_viewed_at: new Date().toISOString() })
      .eq("id", quote.id)
      .is("first_viewed_at", null);
  }

  const today = new Date().toISOString().slice(0, 10);
  const pastValidUntil =
    quote.status === "sent" &&
    quote.valid_until !== null &&
    quote.valid_until < today;
  const organisationName = quote.organisations?.name ?? "The issuer";
  const logoUrl = quote.organisations?.logo_url ?? null;
  const customer = quote.customers;
  const customerAddressLine = customer ? customerAddress(customer) : "";

  // The brand accent, applied sparingly and contrast-safe on a light page: a
  // raw fill for the accent rule and the Accept button (with a readable text
  // colour on it), and a darkened-if-needed shade for brand-coloured text.
  const brand = resolveBrandColor(quote.organisations?.brand_color);
  const brandForeground = brandForegroundColor(brand);
  const brandText = brandTextColor(brand);
  const brandVars = {
    "--brand": brand,
    "--brand-foreground": brandForeground,
  } as CSSProperties;

  const statusLabel = pastValidUntil
    ? "Expired"
    : quote.status === "sent"
      ? "Awaiting your response"
      : quote.status === "accepted"
        ? "Accepted"
        : quote.status === "declined"
          ? "Declined"
          : "Expired";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 print:p-0 sm:px-6 sm:py-12">
      <article
        style={brandVars}
        className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-soft print:rounded-none print:border-0 print:shadow-none"
      >
        {/* The client's brand accent rule across the top of the document. */}
        <div className="h-1.5 w-full" style={{ backgroundColor: brand }} />

        <div className="space-y-8 p-6 sm:p-10">
          <header className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-1">
              {logoUrl ? (
                <>
                  {/* A client logo may be any URL; a plain img avoids coupling
                      to per-host next/image config and needs no optimisation
                      for a one-off document. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoUrl}
                    alt={`${organisationName} logo`}
                    className="max-h-16 w-auto max-w-[220px] object-contain"
                  />
                  <p className="text-sm font-medium text-muted-foreground">
                    {organisationName}
                  </p>
                </>
              ) : (
                <p
                  className="text-2xl font-semibold tracking-tight"
                  style={{ color: brandText }}
                >
                  {organisationName}
                </p>
              )}
            </div>
            <p
              className="text-xs font-semibold uppercase tracking-[0.18em]"
              style={{ color: brandText }}
            >
              Quote
            </p>
          </header>

          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Quote #{quote.quote_number}
              {quote.title ? ` ${quote.title}` : ""}
            </h1>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            <section className="space-y-2">
              <p
                className="text-xs font-semibold uppercase tracking-[0.14em]"
                style={{ color: brandText }}
              >
                Quote details
              </p>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Quote number</dt>
                  <dd className="font-medium">#{quote.quote_number}</dd>
                </div>
                {quote.issued_at ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Issued</dt>
                    <dd className="font-medium">{formatDate(quote.issued_at)}</dd>
                  </div>
                ) : null}
                {quote.valid_until ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Valid until</dt>
                    <dd className="font-medium">
                      {formatDate(quote.valid_until)}
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-medium">{statusLabel}</dd>
                </div>
              </dl>
            </section>

            {customer ? (
              <section className="space-y-2">
                <p
                  className="text-xs font-semibold uppercase tracking-[0.14em]"
                  style={{ color: brandText }}
                >
                  Addressed to
                </p>
                <div className="text-sm not-italic">
                  <p className="font-medium">{customer.name}</p>
                  {customerAddressLine ? (
                    <p className="text-muted-foreground">{customerAddressLine}</p>
                  ) : null}
                  {customer.email ? (
                    <p className="text-muted-foreground">{customer.email}</p>
                  ) : null}
                  {customer.phone ? (
                    <p className="text-muted-foreground">{customer.phone}</p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>

          {quote.sites ? (
            <p className="text-sm text-muted-foreground">
              Site: {quote.sites.name}
              {siteAddressSummary(quote.sites)
                ? `, ${siteAddressSummary(quote.sites)}`
                : ""}
            </p>
          ) : null}

          {quote.status === "accepted" ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              This quote was accepted on {formatDate(quote.updated_at)}.
            </p>
          ) : null}
          {quote.status === "declined" ? (
            <p className="rounded-md border bg-muted px-4 py-3 text-sm text-muted-foreground">
              This quote was declined.
            </p>
          ) : null}
          {quote.status === "expired" || pastValidUntil ? (
            <p className="rounded-md border bg-muted px-4 py-3 text-sm text-muted-foreground">
              This quote has expired. Contact {organisationName} for an updated
              quote.
            </p>
          ) : null}

          <section>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Description</th>
                  <th className="py-2 pr-4 text-right font-medium">Qty</th>
                  <th className="py-2 pr-4 text-right font-medium">
                    Unit price
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">VAT</th>
                  <th className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {quote.quote_line_items.map((line) => (
                  <tr key={line.id} className="border-b last:border-b-0">
                    <td className="py-3 pr-4">{line.description}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {Number(line.quantity).toFixed(2)}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {formatPence(line.unit_price_pence)}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {Number(line.vat_rate)}%
                    </td>
                    <td className="py-3 text-right font-medium tabular-nums">
                      {formatPence(line.line_total_pence)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="ml-auto mt-6 w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular-nums">
                  {formatPence(quote.subtotal_pence)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">VAT</dt>
                <dd className="tabular-nums">{formatPence(quote.vat_pence)}</dd>
              </div>
              <div
                className="mt-1 flex justify-between border-t pt-2 text-base font-semibold"
                style={{ borderColor: brand }}
              >
                <dt>Total</dt>
                <dd className="tabular-nums">
                  {formatPence(quote.total_pence)}
                </dd>
              </div>
            </dl>
          </section>

          {quote.status === "sent" ? (
            <section className="print:hidden">
              <PublicQuoteActions
                acceptAction={publicTransitionFormAction.bind(
                  null,
                  token,
                  "accepted"
                )}
                declineAction={publicTransitionFormAction.bind(
                  null,
                  token,
                  "declined"
                )}
                organisationName={organisationName}
                canAccept={!pastValidUntil}
                brandColor={brand}
                brandForeground={brandForeground}
              />
            </section>
          ) : null}

          <div className="flex justify-end print:hidden">
            <a
              href={`/q/${token}/pdf`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Download PDF
            </a>
          </div>

          <footer className="border-t pt-4 text-xs text-muted-foreground">
            Quote prepared by {organisationName}.
          </footer>
        </div>
      </article>
    </main>
  );
}
