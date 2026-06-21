import { NextResponse, type NextRequest } from "next/server";
import {
  AuthorisationError,
  CAPABILITIES,
  requireModuleEnabled,
  requirePermission,
  type Capability,
} from "@/lib/authorisation";
import { requireWorkspaceAccess } from "@/lib/workspace";

// Stub gate: exists only to prove the authorisation pipeline composes, end
// to end, in the order every future feature action will use. It performs no
// data work. Remove or repurpose once a real feature module exists.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string }> }
) {
  const { orgSlug } = await ctx.params;
  const body = (await request.json()) as {
    module?: string;
    capability?: string;
  };

  if (
    typeof body.module !== "string" ||
    typeof body.capability !== "string" ||
    !(body.capability in CAPABILITIES)
  ) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    // The standard order: auth and tenancy, then module gate, then role.
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, body.module);
    requirePermission(membership, body.capability as Capability);
    return NextResponse.json({ allowed: true });
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return NextResponse.json(
        { allowed: false, reason: error.message },
        { status: 403 }
      );
    }
    // redirect() and notFound() from requireWorkspaceAccess pass through to
    // Next.js, which turns them into the right responses.
    throw error;
  }
}
