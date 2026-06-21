import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { buildQuotePdf, quotePdfFileName } from "@/lib/quotes/pdf";
import { siteAddressSummary, type QuoteSite } from "@/lib/quotes/site-summary";

// In-app PDF download. Gated the standard way: auth and tenancy, then the
// quotes module, then record.read, so a read-only member may download. The
// query is organisation-scoped and a draft, deleted or missing quote is a
// 404; downloads are available once a quote is sent or later. The issuing
// organisation name is the workspace's own name.

export const dynamic = "force-dynamic";

type Customer = {
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
  customers: Customer | null;
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
  ctx: { params: Promise<{ orgSlug: string; quoteId: string }> }
) {
  const { orgSlug, quoteId } = await ctx.params;

  let organisation: {
    id: string;
    name: string;
    brand_color: string | null;
    logo_url: string | null;
  };
  try {
    const access = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(access.organisation, "quotes");
    requirePermission(access.membership, "record.read");
    organisation = access.organisation;
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return new Response("Forbidden", { status: 403 });
    }
    // redirect() and notFound() from the workspace gate pass through.
    throw error;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .select(
      "quote_number, title, status, issued_at, valid_until, subtotal_pence, vat_pence, total_pence, customers (name, email, phone, address_line1, address_line2, town, county, postcode), sites (name, address_line1, address_line2, town, county, postcode), quote_line_items (position, description, quantity, unit_price_pence, vat_rate, line_total_pence)"
    )
    .eq("organisation_id", organisation.id)
    .eq("id", quoteId)
    .is("deleted_at", null)
    .order("position", { referencedTable: "quote_line_items", ascending: true })
    .maybeSingle();
  if (error) throw new Error(error.message);

  const quote = data as unknown as Row | null;
  // Available once sent or later; a draft, deleted or missing quote is a 404.
  if (!quote || quote.status === "draft") {
    return new Response("Not found", { status: 404 });
  }

  const customer = quote.customers;
  const pdf = await buildQuotePdf({
    organisationName: organisation.name,
    brandColor: organisation.brand_color,
    logoUrl: organisation.logo_url,
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
