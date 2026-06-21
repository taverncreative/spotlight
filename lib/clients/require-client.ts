import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type Client = {
  id: string;
  name: string;
  slug: string;
};

// The front of every per-client page and the [clientSlug] layout: authenticate
// (redirect to /login when signed out), resolve the client by slug (RLS scopes
// to operator_id = auth.uid(), so a foreign or unknown slug returns no row and
// 404s), and return the operator and the client.
//
// Wrapped in cache() so the layout and the page share one auth check and one
// client query per request, and so the auth-redirect-then-notFound order is
// identical everywhere. This is what keeps the Slice 6 notFound/auth race from
// recurring on any future module page: pages call requireClient, never their own
// inline auth + client lookup.
export const requireClient = cache(
  async (slug: string): Promise<{ user: User; client: Client }> => {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const { data: client } = await supabase
      .from("clients")
      .select("id, name, slug")
      .eq("slug", slug)
      .maybeSingle();
    if (!client) notFound();

    return { user, client };
  }
);
