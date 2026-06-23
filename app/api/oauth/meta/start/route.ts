import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildConsentUrl } from "@/lib/oauth/meta";
import { appUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "meta_oauth_state";

// Begins the Meta connect flow: operator session required, then 302 to the
// Facebook consent dialog with the Page + Instagram publishing scopes. A random
// CSRF token is stored in an httpOnly cookie and echoed via state so the callback
// can verify the round-trip. The redirect URI is built from APP_BASE_URL (the
// ngrok tunnel in dev), matching the Google routes — never hardcoded localhost.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(appUrl("/login"));
  }

  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(buildConsentUrl(state), 302);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}
