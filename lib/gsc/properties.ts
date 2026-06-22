import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  GSC_PROVIDER,
  getValidAccessToken,
  TokenRefreshError,
} from "@/lib/oauth/google";

// Lists the operator's verified Search Console properties. This is the first
// live use of the token layer: it loads the stored connection and goes through
// getValidAccessToken (which refreshes and persists a fresh token when the
// stored one is near expiry) before calling the Search Console sites.list API.

export type GscProperty = {
  siteUrl: string;
  permissionLevel: string;
};

// Discriminated result so callers (the page, the form, the save validation) can
// branch without exceptions: a missing connection or a revoked grant are normal
// states, not errors.
export type GscPropertiesResult =
  | { status: "connected"; properties: GscProperty[] }
  | { status: "not_connected" }
  | { status: "reconnect_needed" };

const SITES_ENDPOINT = "https://www.googleapis.com/webmasters/v3/sites";

type SiteEntry = { siteUrl: string; permissionLevel: string };

async function fetchGscProperties(): Promise<GscPropertiesResult> {
  const supabase = await createClient();
  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("id, access_token, refresh_token, token_expiry")
    .eq("provider", GSC_PROVIDER)
    .maybeSingle();
  if (!connection) return { status: "not_connected" };

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(connection);
  } catch (error) {
    // A revoked/expired grant can't be refreshed; prompt a reconnect instead of
    // crashing the Sites page.
    if (error instanceof TokenRefreshError) return { status: "reconnect_needed" };
    throw error;
  }

  const res = await fetch(SITES_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    // Token rejected at the API even after refresh → the grant needs redoing.
    if (res.status === 401 || res.status === 403) {
      return { status: "reconnect_needed" };
    }
    throw new Error(`Search Console sites.list failed: ${res.status}`);
  }

  const data = (await res.json()) as { siteEntry?: SiteEntry[] };
  const properties = (data.siteEntry ?? [])
    .filter((entry) => entry.permissionLevel !== "siteUnverifiedUser")
    .map((entry) => ({
      siteUrl: entry.siteUrl,
      permissionLevel: entry.permissionLevel,
    }));
  return { status: "connected", properties };
}

// Request-scoped memoisation: one sites.list per render even if read in several
// places, and a single refresh if the token was stale.
export const listGscProperties = cache(fetchGscProperties);

// True when the value is null (unmapped) or one of the operator's verified
// properties; used server-side so an arbitrary siteUrl can't be stored.
export function isAllowedProperty(
  result: GscPropertiesResult,
  value: string | null
): boolean {
  if (value === null) return true;
  return (
    result.status === "connected" &&
    result.properties.some((property) => property.siteUrl === value)
  );
}
