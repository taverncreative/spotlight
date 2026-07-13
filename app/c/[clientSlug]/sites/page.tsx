import { redirect } from "next/navigation";

// The Sites list has merged into Overview (site management now lives in the
// Overview "Site health" section). This route is kept as a redirect so existing
// bookmarks and links do not 404; the per-site check history at
// /sites/[siteId] stays fully intact.
export default async function SitesPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  redirect(`/c/${clientSlug}/overview`);
}
