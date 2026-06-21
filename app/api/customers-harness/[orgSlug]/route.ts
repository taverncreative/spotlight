import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AuthorisationError } from "@/lib/authorisation";
import {
  createCustomer,
  getCustomer,
  listCustomers,
  listDeletedCustomers,
  restoreCustomer,
  softDeleteCustomer,
  updateCustomer,
} from "@/app/app/[orgSlug]/customers/actions";

// Test harness: invokes the real customers server actions with the caller's
// real session, the same approach as the leads harness. It adds nothing on
// top; every gate lives inside the actions themselves.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string }> }
) {
  const { orgSlug } = await ctx.params;
  const body = (await request.json()) as { action?: string; input?: unknown };

  const actions: Record<
    string,
    (slug: string, input: unknown) => Promise<unknown>
  > = {
    listCustomers,
    listDeletedCustomers,
    getCustomer,
    createCustomer,
    updateCustomer,
    softDeleteCustomer,
    restoreCustomer,
  };

  const action = body.action ? actions[body.action] : undefined;
  if (!action) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const data = await action(orgSlug, body.input ?? {});
    return NextResponse.json({ data: data ?? null });
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // redirect() and notFound() from the workspace gate pass through.
    throw error;
  }
}
