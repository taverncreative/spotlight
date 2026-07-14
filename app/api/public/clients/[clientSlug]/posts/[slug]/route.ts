import { NextResponse } from "next/server";
import { createPublicClient, resolveClientId } from "@/lib/content-api/auth";

// Public content API -- a single PUBLISHED post by slug (full Markdown body).
// Same keyed, anon, no-store, function-only read path as the list route. A draft
// (or unknown) slug returns 404, since the function returns no row for it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientSlug: string; slug: string }> }
) {
  const { clientSlug, slug } = await params;
  const supabase = createPublicClient();

  const clientId = await resolveClientId(supabase, request, clientSlug);
  if (!clientId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE }
    );
  }

  const { data, error } = await supabase.rpc("published_post", {
    p_client_id: clientId,
    p_slug: slug,
  });
  if (error) {
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500, headers: NO_STORE }
    );
  }

  // published (or unknown) only: a draft slug yields no row -> 404.
  const post = Array.isArray(data) ? data[0] : null;
  if (!post) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: NO_STORE }
    );
  }

  return NextResponse.json(post, { headers: NO_STORE });
}
