import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken, TokenRefreshError } from "@/lib/oauth/google";

// Lists the operator's Google Analytics 4 properties via the Analytics Admin API
// accountSummaries.list (v1beta — the GA/stable version). Twin of
// lib/gsc/properties.ts: loads the google_analytics connection and goes through
// getValidAccessToken (refresh + persist on near-expiry) before the API call.

const GA4_PROVIDER = "google_analytics";

const ACCOUNT_SUMMARIES_ENDPOINT =
  "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";

export type Ga4Property = {
  property: string; // "properties/NNN" resource name
  displayName: string;
};

export type Ga4PropertiesResult =
  | { status: "connected"; properties: Ga4Property[] }
  | { status: "not_connected" }
  | { status: "reconnect_needed" };

type PropertySummary = { property?: string; displayName?: string };
type AccountSummary = { propertySummaries?: PropertySummary[] };

async function fetchGa4Properties(): Promise<Ga4PropertiesResult> {
  const supabase = await createClient();
  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("id, access_token, refresh_token, token_expiry")
    .eq("provider", GA4_PROVIDER)
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

  const res = await fetch(`${ACCOUNT_SUMMARIES_ENDPOINT}?pageSize=200`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    // Token rejected at the API even after refresh → the grant needs redoing.
    if (res.status === 401 || res.status === 403) {
      return { status: "reconnect_needed" };
    }
    throw new Error(`Analytics accountSummaries.list failed: ${res.status}`);
  }

  const data = (await res.json()) as { accountSummaries?: AccountSummary[] };
  const properties: Ga4Property[] = [];
  for (const account of data.accountSummaries ?? []) {
    for (const summary of account.propertySummaries ?? []) {
      if (summary.property) {
        properties.push({
          property: summary.property,
          displayName: summary.displayName ?? summary.property,
        });
      }
    }
  }
  return { status: "connected", properties };
}

// Request-scoped memoisation: one accountSummaries.list per render, and a single
// refresh if the token was stale.
export const listGa4Properties = cache(fetchGa4Properties);

// True when the value is null (unmapped) or one of the operator's GA4
// properties; used server-side so an arbitrary resource name can't be stored.
export function isAllowedGa4Property(
  result: Ga4PropertiesResult,
  value: string | null
): boolean {
  if (value === null) return true;
  return (
    result.status === "connected" &&
    result.properties.some((property) => property.property === value)
  );
}
