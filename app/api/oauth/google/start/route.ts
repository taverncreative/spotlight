import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildConsentUrl } from "@/lib/oauth/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

// Begins the Google Search Console connect flow: operator session required,
// then 302 to Google's consent screen with a random CSRF state held in a
// short-lived httpOnly cookie.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
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
