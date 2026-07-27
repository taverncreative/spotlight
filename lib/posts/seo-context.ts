import { createClient } from "@/lib/supabase/server";

// The bits of SEO context that live in the database rather than in the form.
//
// Only the internal-link check needs this: telling an internal link from an
// external one means knowing which hosts belong to the client. Fetched on the
// server and handed to the form, so the pure scorer stays free of the database.
//
// BOTH sources, because neither is reliable on its own. blog_base_url is null on
// every client today (see 0061), so the sites table carries this in practice;
// but a client can have a blog base and no monitored site, and one with neither
// gets an honest "no site on record" rather than a failure it cannot fix.
export type SeoContext = {
  siteUrls: string[];
  blogBaseUrl: string | null;
};

export async function seoContextForClient(
  clientId: string
): Promise<SeoContext> {
  const supabase = await createClient();
  const [sites, client] = await Promise.all([
    supabase.from("sites").select("url").eq("client_id", clientId),
    supabase
      .from("clients")
      .select("blog_base_url")
      .eq("id", clientId)
      .maybeSingle(),
  ]);

  return {
    // Every site the client has, monitored or not: an unmonitored site is still
    // the client's own site, and linking to it is still an internal link.
    siteUrls: (sites.data ?? []).map((site) => site.url as string),
    blogBaseUrl: (client.data?.blog_base_url as string | null) ?? null,
  };
}

// Whole days since publication, or null for a draft.
//
// Lives here rather than in the page for two reasons: it keeps the clock out of
// both the pure scorer and the component body (where reading Date.now during
// render is a purity violation), and it puts every database-or-clock input the
// checklist needs in one module.
export function ageDaysSince(publishedAt: string | null): number | null {
  if (!publishedAt) return null;
  const published = new Date(publishedAt).getTime();
  if (Number.isNaN(published)) return null;
  return Math.floor((new Date().getTime() - published) / 86_400_000);
}
