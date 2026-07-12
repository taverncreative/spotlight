import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  META_PROVIDER,
  META_SCOPES,
  META_TOKEN_TTL_MS,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchPages,
  fetchInstagramAccount,
} from "@/lib/oauth/meta";
import { encryptToken } from "@/lib/oauth/encryption";
import { appUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "meta_oauth_state";

// Completes the Meta connect flow: verify the operator session and CSRF state,
// exchange the code for a long-lived user token, then discover and store the
// operator's Pages and their linked Instagram accounts. The user token is stored
// encrypted in oauth_connections (provider "facebook"); each Page becomes a
// facebook meta_accounts row with its encrypted Page token, and each linked
// Instagram becomes an instagram row pointing at its Page via parent_account_id.
// Token/discovery errors redirect back with an error flag, never 500.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(appUrl("/login"));
  }

  // request.url is only read for its query string (code/state/error); the
  // redirect targets are built from the app's public base URL so they stay on
  // the tunnel/deployed origin instead of the localhost the server binds to.
  const url = new URL(request.url);
  const integrations = appUrl("/settings/integrations");
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

  try {
    const short = await exchangeCodeForToken(code);
    const long = await exchangeForLongLivedToken(short.access_token);

    const userExpiry = new Date(
      Date.now() +
        (long.expires_in ? long.expires_in * 1000 : META_TOKEN_TTL_MS)
    ).toISOString();

    const { error: connError } = await supabase
      .from("oauth_connections")
      .upsert(
        {
          operator_id: user.id,
          provider: META_PROVIDER,
          access_token: encryptToken(long.access_token),
          refresh_token: null, // Meta has no refresh token
          token_expiry: userExpiry,
          scopes: [...META_SCOPES],
          account_email: null, // email scope not requested
        },
        { onConflict: "operator_id,provider" }
      );
    if (connError) return fail("store_failed");

    // Page tokens derived from a long-lived user token are themselves
    // long-lived; mark them with the same ~60-day expiry as a refresh signal.
    const pageExpiry = new Date(Date.now() + META_TOKEN_TTL_MS).toISOString();
    const pages = await fetchPages(long.access_token);

    for (const page of pages) {
      const { data: fbRow, error: fbError } = await supabase
        .from("meta_accounts")
        .upsert(
          {
            operator_id: user.id,
            platform: "facebook",
            external_id: page.id,
            display_name: page.name,
            access_token: encryptToken(page.access_token),
            token_expires_at: pageExpiry,
            parent_account_id: null,
            // Reconnect clears any prior auth failure. client_id is omitted so a
            // re-connect preserves an existing client assignment (it defaults to
            // null only on first insert).
            needs_reconnect: false,
          },
          { onConflict: "platform,external_id" }
        )
        .select("id")
        .single();
      if (fbError || !fbRow) continue;

      const igId = page.instagram_business_account?.id;
      if (!igId) continue;

      // The Instagram business account publishes through its Page token, so we
      // store that token on the IG row too and link it to the Page.
      const ig = await fetchInstagramAccount(igId, page.access_token);
      await supabase.from("meta_accounts").upsert(
        {
          operator_id: user.id,
          platform: "instagram",
          external_id: igId,
          display_name: ig?.username ?? ig?.name ?? page.name,
          access_token: encryptToken(page.access_token),
          token_expires_at: pageExpiry,
          parent_account_id: fbRow.id,
          needs_reconnect: false,
        },
        { onConflict: "platform,external_id" }
      );
    }

    integrations.searchParams.set("connected", "1");
    const response = NextResponse.redirect(integrations);
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch {
    return fail("exchange_failed");
  }
}
