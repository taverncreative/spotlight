import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AuthorisationError } from "@/lib/authorisation";
import {
  convertLeadToCustomer,
  createLead,
  getLead,
  listDeletedLeads,
  listLeads,
  restoreLead,
  softDeleteLead,
  updateLead,
} from "@/app/app/[orgSlug]/leads/actions";

// Test harness: invokes the real leads server actions with the caller's
// real session, so the automated tests exercise exactly what the Pass 1C
// screens will call. It adds nothing on top; every gate lives inside the
// actions themselves.
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
    listLeads,
    listDeletedLeads,
    getLead,
    createLead,
    updateLead,
    softDeleteLead,
    restoreLead,
    convertLeadToCustomer,
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
