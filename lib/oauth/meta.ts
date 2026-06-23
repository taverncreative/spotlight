import "server-only";
import { appBaseUrl } from "@/lib/app-url";

// Meta (Facebook + Instagram) OAuth + Graph helpers. The connect flow exchanges
// the consent code for a short-lived user token, upgrades it to a ~60-day
// long-lived token, then lists the operator's Pages and their linked Instagram
// business accounts. Meta has no refresh token — the long-lived token is
// re-minted by reconnecting. Tokens are encrypted via lib/oauth/encryption
// before storage. All calls are pinned to Graph v25.0.

export const META_PROVIDER = "facebook"; // oauth_connections.provider value

export const GRAPH_VERSION = "v25.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const OAUTH_DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

// Absolute Graph API URL for a path (e.g. graphUrl(`/${pageId}/photos`)), pinned
// to the version above. Single source for the host/version so the publisher and
// the connect flow can't drift apart.
export function graphUrl(path: string): string {
  return `${GRAPH}${path}`;
}

// Facebook-Login-via-Page path: Page listing/posting, plus Instagram publishing
// through the linked Page (instagram_basic + instagram_content_publish), plus
// business_management for Business-owned Pages. Meta wants these comma-joined.
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
] as const;

// Long-lived Meta tokens last ~60 days. Used as the stored expiry marker for the
// user connection and for the Page/IG rows (Meta does not return a per-Page
// expiry on /me/accounts).
export const META_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

// Same app-base-URL source the Google routes use (the ngrok tunnel in dev, the
// deployed origin in prod), so the redirect URI matches the one registered in
// the Meta app exactly.
export function getMetaRedirectUri(): string {
  return `${appBaseUrl()}/api/oauth/meta/callback`;
}

function getCredentials(): { appId: string; appSecret: string } {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error(
      "META_APP_ID and META_APP_SECRET must be set (in .env.local for dev)."
    );
  }
  return { appId, appSecret };
}

export function buildConsentUrl(state: string): string {
  const { appId } = getCredentials();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: getMetaRedirectUri(),
    response_type: "code",
    scope: META_SCOPES.join(","),
    state,
  });
  return `${OAUTH_DIALOG}?${params.toString()}`;
}

export type MetaTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

// Consent code -> short-lived user access token.
export async function exchangeCodeForToken(
  code: string
): Promise<MetaTokenResponse> {
  const { appId, appSecret } = getCredentials();
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", getMetaRedirectUri());
  url.searchParams.set("code", code);
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Meta code exchange failed: ${res.status}`);
  }
  return (await res.json()) as MetaTokenResponse;
}

// Short-lived user token -> ~60-day long-lived user token. Meta has no refresh
// token; reconnecting re-mints this.
export async function exchangeForLongLivedToken(
  shortToken: string
): Promise<MetaTokenResponse> {
  const { appId, appSecret } = getCredentials();
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Meta long-lived token exchange failed: ${res.status}`);
  }
  return (await res.json()) as MetaTokenResponse;
}

export type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string } | null;
};

// The operator's Pages, each with its own Page token and the linked Instagram
// business account id (if any). Follows Graph paging defensively, capped so a
// bad cursor can't loop forever.
export async function fetchPages(userToken: string): Promise<MetaPage[]> {
  const first = new URL(`${GRAPH}/me/accounts`);
  first.searchParams.set(
    "fields",
    "id,name,access_token,instagram_business_account"
  );
  first.searchParams.set("access_token", userToken);
  first.searchParams.set("limit", "100");

  const pages: MetaPage[] = [];
  let next: string | null = first.toString();
  for (let guard = 0; next && guard < 10; guard++) {
    const res = await fetch(next);
    if (!res.ok) {
      throw new Error(`Meta /me/accounts failed: ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: MetaPage[];
      paging?: { next?: string };
    };
    pages.push(...(json.data ?? []));
    next = json.paging?.next ?? null;
  }
  return pages;
}

export type MetaIgAccount = {
  id: string;
  username?: string;
  name?: string;
};

// Discover an Instagram business account's display fields, reached through the
// Page token it is linked to. Returns null on any error so connect never fails
// just because a display name couldn't be read.
export async function fetchInstagramAccount(
  igId: string,
  pageToken: string
): Promise<MetaIgAccount | null> {
  const url = new URL(`${GRAPH}/${igId}`);
  url.searchParams.set("fields", "id,username,name");
  url.searchParams.set("access_token", pageToken);
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as MetaIgAccount;
}
