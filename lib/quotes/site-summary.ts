// A site's address as a single comma-separated line, shared by the quote
// detail view, the public quote page and the PDF so the location reads the
// same everywhere. Pure, no server-only, so the client header form could reuse
// it too.

export type QuoteSite = {
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
};

export function siteAddressSummary(site: QuoteSite): string {
  return [
    site.address_line1,
    site.address_line2,
    site.town,
    site.county,
    site.postcode,
  ]
    .filter(Boolean)
    .join(", ");
}
