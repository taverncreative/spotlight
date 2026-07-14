import { NextResponse } from "next/server";
import { createPublicClient, resolveClientId } from "@/lib/content-api/auth";

// Public content API -- list a client's PUBLISHED posts (no body; index-light).
// Keyed by a per-client read key (Authorization: Bearer). Reads only through the
// SECURITY DEFINER functions on the anon client; never falls back to the
// operator or service-role client. Not cached (no-store) -- consuming sites
// cache their own fetches.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientSlug: string }> }
) {
  const { clientSlug } = await params;
  const supabase = createPublicClient();

  // Uniform 401 for a bad/absent key AND an unknown slug -- no slug enumeration.
  const clientId = await resolveClientId(supabase, request, clientSlug);
  if (!clientId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE }
    );
  }

  const { data, error } = await supabase.rpc("published_posts", {
    p_client_id: clientId,
  });
  if (error) {
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500, headers: NO_STORE }
    );
  }

  // The function already returns only the allowlisted, published columns.
  return NextResponse.json(data ?? [], { headers: NO_STORE });
}
