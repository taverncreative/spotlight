import "server-only";
import { createClient } from "@/lib/supabase/server";
import { decryptToken, encryptToken } from "@/lib/oauth/encryption";
import { appBaseUrl } from "@/lib/app-url";

// Google Search Console OAuth: consent URL, code exchange, and the token-refresh
// helper every later GSC call goes through. Reads GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET; tokens are encrypted via lib/oauth/encryption.

export const GSC_PROVIDER = "google_search_console";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// Single source for the OAuth callback origin so the redirect URI matches the
// registered one exactly. Built from the shared app base URL (the ngrok tunnel
// in dev, the deployed origin in prod).
export function getRedirectUri(): string {
  return `${appBaseUrl()}/api/oauth/google/callback`;
}

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set (in .env.local for dev)."
    );
  }
  return { clientId, clientSecret };
}

export function buildConsentUrl(state: string, scopes: string[]): string {
  const { clientId } = getCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

export async function exchangeCodeForTokens(
  code: string
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getCredentials();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

// The connected account email from the id_token's payload (no signature check
// needed: it came straight from Google's token endpoint over TLS).
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const segments = idToken.split(".");
  if (segments.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8")
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

// Thrown when a refresh fails (e.g. the grant was revoked) so callers can prompt
// a reconnect rather than treating it as a transient error.
export class TokenRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenRefreshError";
  }
}

type StoredConnection = {
  id: string;
  access_token: string; // ciphertext
  refresh_token: string | null; // ciphertext
  token_expiry: string | null;
};

// Returns a usable (decrypted) access token, refreshing and persisting a fresh
// one when the stored token is within ~60s of expiry. Every later GSC call uses
// this so it never sends an expired token.
export async function getValidAccessToken(
  connection: StoredConnection
): Promise<string> {
  const expiryMs = connection.token_expiry
    ? new Date(connection.token_expiry).getTime()
    : 0;
  if (expiryMs - Date.now() > 60_000) {
    return decryptToken(connection.access_token);
  }

  if (!connection.refresh_token) {
    throw new TokenRefreshError(
      "No refresh token stored for this connection; reconnect required."
    );
  }

  const { clientId, clientSecret } = getCredentials();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptToken(connection.refresh_token),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new TokenRefreshError(
      `Google token refresh failed (${res.status}); reconnect required.`
    );
  }

  const data = (await res.json()) as GoogleTokenResponse;
  const tokenExpiry = new Date(
    Date.now() + data.expires_in * 1000
  ).toISOString();

  const supabase = await createClient();
  await supabase
    .from("oauth_connections")
    .update({
      access_token: encryptToken(data.access_token),
      token_expiry: tokenExpiry,
    })
    .eq("id", connection.id);

  return data.access_token;
}
