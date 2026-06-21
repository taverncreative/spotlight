import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AuthorisationError } from "@/lib/authorisation";
import {
  addLineItem,
  createQuote,
  getQuote,
  listDeletedQuotes,
  listQuotes,
  removeLineItem,
  restoreQuote,
  softDeleteQuote,
  transitionQuoteStatus,
  updateLineItem,
  updateQuote,
} from "@/app/app/[orgSlug]/quotes/actions";

// Test harness: invokes the real quotes server actions with the caller's
// real session, the same approach as the leads and customers harnesses.
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
    listQuotes,
    listDeletedQuotes,
    getQuote,
    createQuote,
    updateQuote,
    softDeleteQuote,
    restoreQuote,
    addLineItem,
    updateLineItem,
    removeLineItem,
    transitionQuoteStatus,
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
