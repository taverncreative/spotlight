import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AuthorisationError } from "@/lib/authorisation";
import {
  createContact,
  deleteContact,
  listContacts,
  updateContact,
} from "@/app/app/[orgSlug]/contacts/actions";

// Test harness: invokes the real contacts server actions with the caller's
// real session, the same approach as the other module harnesses.
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
    listContacts,
    createContact,
    updateContact,
    deleteContact,
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
    throw error;
  }
}
