import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AuthorisationError } from "@/lib/authorisation";
import {
  createWebhookForm,
  listWebhookForms,
  regenerateWebhookFormToken,
  setWebhookFormStatus,
} from "@/app/app/[orgSlug]/leads/forms/actions";

// Test harness: invokes the real form-management actions with the caller's
// real session, the same approach as the leads and quotes harnesses. Every
// gate lives inside the actions; this adds nothing on top.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ orgSlug: string }> }
) {
  const { orgSlug } = await ctx.params;
  const body = (await request.json()) as { action?: string; input?: unknown };

  const withInput: Record<
    string,
    (slug: string, input: unknown) => Promise<unknown>
  > = {
    createWebhookForm,
    setWebhookFormStatus,
    regenerateWebhookFormToken,
  };
  const noInput: Record<string, (slug: string) => Promise<unknown>> = {
    listWebhookForms,
  };

  try {
    if (body.action && body.action in noInput) {
      const data = await noInput[body.action](orgSlug);
      return NextResponse.json({ data: data ?? null });
    }
    if (body.action && body.action in withInput) {
      const data = await withInput[body.action](orgSlug, body.input ?? {});
      return NextResponse.json({ data: data ?? null });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
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
