import { createAdminClient } from "@/lib/supabase/admin";
import { buildQuotePdf, quotePdfFileName } from "@/lib/quotes/pdf";
import { siteAddressSummary, type QuoteSite } from "@/lib/quotes/site-summary";

// Public PDF download. The same surface and rules as the public page
// (app/q/[token]/page.tsx): no auth, the token is the only key, the read
// goes through the service role scoped by it, and only the publicly visible
// statuses are served. A draft, deleted or unknown token gets the same
// generic 404 and never a PDF.

export const dynamic = "force-dynamic";

const PUBLIC_STATUSES = ["sent", "accepted", "declined", "expired"];

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

type Row = {
  quote_number: number;
  title: string | null;
  status: string;
  issued_at: string | null;
  valid_until: string | null;
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  organisations: {
    name: string;
    brand_color: string | null;
    logo_url: string | null;
  } | null;
  customers: PublicCustomer | null;
  sites: QuoteSite | null;
  quote_line_items: {
    description: string;
    quantity: number;
    unit_price_pence: number;
    vat_rate: number;
    line_total_pence: number;
  }[];
};

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) {
    return new Response("Not found", { status: 404 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("quotes")
    .select(
      "quote_number, title, status, issued_at, valid_until, subtotal_pence, vat_pence, total_pence, organisations (name, brand_color, logo_url), customers (name, email, phone, address_line1, address_line2, town, county, postcode), sites (name, address_line1, address_line2, town, county, postcode), quote_line_items (position, description, quantity, unit_price_pence, vat_rate, line_total_pence)"
    )
    .eq("public_token", token)
    .is("deleted_at", null)
    .in("status", PUBLIC_STATUSES)
    .order("position", { referencedTable: "quote_line_items", ascending: true })
    .maybeSingle();

  const quote = data as unknown as Row | null;
  if (!quote) {
    return new Response("Not found", { status: 404 });
  }

  const customer = quote.customers;
  const pdf = await buildQuotePdf({
    organisationName: quote.organisations?.name ?? "The issuer",
    brandColor: quote.organisations?.brand_color ?? null,
    logoUrl: quote.organisations?.logo_url ?? null,
    quoteNumber: quote.quote_number,
    title: quote.title,
    status: quote.status,
    issuedAt: quote.issued_at,
    validUntil: quote.valid_until,
    customerName: customer?.name ?? null,
    customerAddress: customer ? siteAddressSummary(customer) : null,
    customerEmail: customer?.email ?? null,
    customerPhone: customer?.phone ?? null,
    siteName: quote.sites?.name ?? null,
    siteAddress: quote.sites ? siteAddressSummary(quote.sites) : null,
    subtotalPence: quote.subtotal_pence,
    vatPence: quote.vat_pence,
    totalPence: quote.total_pence,
    lines: quote.quote_line_items,
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${quotePdfFileName(quote.quote_number)}"`,
    },
  });
}
