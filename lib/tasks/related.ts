import type { SupabaseClient } from "@supabase/supabase-js";

// Resolving the display name of a task's linked record (Pass 6D). The link is
// polymorphic (related_type/related_id, no foreign key), so the main Tasks list
// shows the record's type and name and links to its page. Sites have no
// standalone detail page this pass, so a site link resolves to a name with no
// href. A record that was hard-deleted simply does not come back from the
// query, so its task degrades to the bare type label with no link.

export const RELATED_LABELS: Record<string, string> = {
  lead: "Lead",
  customer: "Customer",
  site: "Site",
  quote: "Quote",
};

// The detail-page route segment per type, or null where there is no page.
const RELATED_SEGMENT: Record<string, string | null> = {
  lead: "leads",
  customer: "customers",
  site: null,
  quote: "quotes",
};

export type RelatedRef = { label: string; name: string; href: string | null };

const keyOf = (type: string, id: string) => `${type}:${id}`;

// Resolve a batch of (type, id) links in one query per type, never one per row.
// Returns a map keyed by "<type>:<id>"; absent keys mean the record could not be
// read (hard-deleted), which the caller renders as unavailable.
export async function resolveRelatedRefs(
  supabase: SupabaseClient,
  orgSlug: string,
  organisationId: string,
  pairs: { type: string; id: string }[]
): Promise<Map<string, RelatedRef>> {
  const idsByType = new Map<string, Set<string>>();
  for (const { type, id } of pairs) {
    if (!(type in RELATED_LABELS)) continue;
    if (!idsByType.has(type)) idsByType.set(type, new Set());
    idsByType.get(type)!.add(id);
  }

  const refs = new Map<string, RelatedRef>();
  for (const [type, idSet] of idsByType) {
    const ids = [...idSet];
    const label = RELATED_LABELS[type];
    const segment = RELATED_SEGMENT[type];

    if (type === "quote") {
      const { data } = await supabase
        .from("quotes")
        .select("id, quote_number, title")
        .eq("organisation_id", organisationId)
        .in("id", ids);
      for (const row of (data ?? []) as {
        id: string;
        quote_number: number;
        title: string | null;
      }[]) {
        const name = `Quote #${row.quote_number}${row.title ? ` ${row.title}` : ""}`;
        refs.set(keyOf("quote", row.id), {
          label,
          name,
          href: `/app/${orgSlug}/quotes/${row.id}`,
        });
      }
      continue;
    }

    const table = type === "lead" ? "leads" : type === "customer" ? "customers" : "sites";
    const { data } = await supabase
      .from(table)
      .select("id, name")
      .eq("organisation_id", organisationId)
      .in("id", ids);
    for (const row of (data ?? []) as { id: string; name: string | null }[]) {
      refs.set(keyOf(type, row.id), {
        label,
        name: row.name?.trim() || label,
        href: segment ? `/app/${orgSlug}/${segment}/${row.id}` : null,
      });
    }
  }
  return refs;
}
