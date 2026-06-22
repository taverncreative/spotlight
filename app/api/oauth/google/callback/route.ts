import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForTokens,
  emailFromIdToken,
} from "@/lib/oauth/google";
import { isGoogleProvider, scopesFor } from "@/lib/oauth/providers";
import { encryptToken } from "@/lib/oauth/encryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

// Completes the connect flow: verify the operator session and CSRF state,
// exchange the code for tokens, store them encrypted, then return to the
// Integrations page. Token errors redirect back with an error flag, never 500.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const integrations = new URL("/settings/integrations", request.url);
  const stateCookie = (await cookies()).get(STATE_COOKIE)?.value;

  const fail = (reason: string) => {
    integrations.searchParams.set("error", reason);
    const response = NextResponse.redirect(integrations);
    response.cookies.delete(STATE_COOKIE);
    return response;
  };

  const providerError = url.searchParams.get("error");
  if (providerError) return fail(providerError);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !stateCookie || state !== stateCookie) {
    return fail("state_mismatch");
  }

  // The provider is the prefix of the verified state (state === our httpOnly
  // cookie), so which product is being completed is trustworthy.
  const provider = state.split(":")[0];
  if (!isGoogleProvider(provider)) return fail("bad_provider");

  try {
    const tokens = await exchangeCodeForTokens(code);
    const accountEmail = emailFromIdToken(tokens.id_token);

    // A re-consent may omit the refresh token; preserve the stored one.
    let refreshCipher: string | null;
    if (tokens.refresh_token) {
      refreshCipher = encryptToken(tokens.refresh_token);
    } else {
      const { data: existing } = await supabase
        .from("oauth_connections")
        .select("refresh_token")
        .eq("provider", provider)
        .maybeSingle();
      refreshCipher = existing?.refresh_token ?? null;
    }

    const tokenExpiry = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();

    const { error } = await supabase.from("oauth_connections").upsert(
      {
        operator_id: user.id,
        provider,
        access_token: encryptToken(tokens.access_token),
        refresh_token: refreshCipher,
        token_expiry: tokenExpiry,
        scopes: scopesFor(provider),
        account_email: accountEmail,
      },
      { onConflict: "operator_id,provider" }
    );
    if (error) return fail("store_failed");

    integrations.searchParams.set("connected", "1");
    const response = NextResponse.redirect(integrations);
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch {
    return fail("exchange_failed");
  }
}
