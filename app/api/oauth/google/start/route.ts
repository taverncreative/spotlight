import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildConsentUrl } from "@/lib/oauth/google";
import { appUrl } from "@/lib/app-url";
import {
  isGoogleProvider,
  scopesFor,
  DEFAULT_GOOGLE_PROVIDER,
} from "@/lib/oauth/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

// Begins a Google connect flow for the requested product: operator session
// required, then 302 to Google's consent screen with that product's scopes. The
// provider is carried in the CSRF state (provider:csrf) so the callback knows
// which product it is completing.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(appUrl("/login"));
  }

  // Default to Search Console so the original link keeps working unchanged.
  const providerParam = new URL(request.url).searchParams.get("provider");
  const provider = isGoogleProvider(providerParam)
    ? providerParam
    : DEFAULT_GOOGLE_PROVIDER;

  const state = `${provider}:${randomBytes(16).toString("hex")}`;
  const response = NextResponse.redirect(
    buildConsentUrl(state, scopesFor(provider)),
    302
  );
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}
