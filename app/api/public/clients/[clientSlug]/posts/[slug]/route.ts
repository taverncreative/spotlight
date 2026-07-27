import { NextResponse } from "next/server";
import { createPublicClient, resolveClientId } from "@/lib/content-api/auth";
import { composeSchemas, parseSchemas } from "@/lib/posts/structured-data";

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

  // schemas is the one field the route SHAPES rather than passes through.
  //
  // The function returns only what the operator authored (migration 0070);
  // Article is composed here from columns the function has already decided are
  // public, so nothing is widened. Composing rather than storing is what keeps
  // datePublished honest: publishing from the blog list changes published_at
  // without going near the editor, and a stored copy would not notice.
  //
  // client_name and updated_at are inputs to that composition, not part of the
  // contract, so they are dropped from the response rather than added to it.
  const { schemas, client_name, updated_at, ...rest } = post;
  const body = {
    ...rest,
    schemas: composeSchemas(
      {
        title: post.title,
        metaTitle: post.meta_title,
        metaDescription: post.meta_description,
        excerpt: post.excerpt,
        featuredImage: post.featured_image,
        publishedAt: post.published_at,
        updatedAt: updated_at,
        clientName: client_name,
      },
      parseSchemas(schemas)
    ),
  };

  return NextResponse.json(body, { headers: NO_STORE });
}
