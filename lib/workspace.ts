import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Front of the standard pipeline (docs/architecture.md section 6):
// validate auth, resolve the organisation from the slug, check membership.
// Signed-out visitors go to login; non-members get a 404 so workspace slugs
// are not confirmed to outsiders. RLS already hides other organisations'
// rows; the explicit membership check is the documented second layer.
// Wrapped in cache() so layout and page share one lookup per request.
export const requireWorkspaceAccess = cache(async (orgSlug: string) => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: organisation } = await supabase
    .from("organisations")
    .select("id, name, slug, brand_color, logo_url")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (!organisation) notFound();

  const { data: membership } = await supabase
    .from("organisation_memberships")
    .select("id, role")
    .eq("organisation_id", organisation.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) notFound();

  return { user, organisation, membership };
});
