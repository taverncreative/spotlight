import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AuthorisationError } from "@/lib/authorisation";
import {
  createFileDownloadUrl,
  deleteFile,
  listFiles,
  prepareFileUpload,
  recordFile,
} from "@/app/app/[orgSlug]/files/actions";

// Test harness: invokes the real files server actions with the caller's real
// session, the same approach as the other module harnesses. Every gate lives
// inside the actions themselves. The upload of bytes itself is browser-direct
// to storage on the user session and so is not routed through here; the test
// performs it with a signed-in storage client, exactly as a browser would.
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
    prepareFileUpload,
    recordFile,
    listFiles,
    createFileDownloadUrl,
    deleteFile,
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
