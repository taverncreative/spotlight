import "server-only";
import { GRAPH_VERSION } from "@/lib/oauth/meta";
import {
  FB_FIELDS,
  IG_FIELDS,
  parseInsights,
  type PostInsights,
} from "@/lib/social/insights-fields";

// Reading per-post engagement back from Meta. The field mapping and the whole
// explanation of what is available lives in insights-fields.ts, which is pure
// and tested; this half only does the request, because it handles a decrypted
// token and must never reach a client bundle.

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type InsightsResult =
  | { ok: true; insights: PostInsights }
  | { ok: false; error: string };

export async function fetchInsights(
  platform: string,
  platformPostId: string,
  token: string
): Promise<InsightsResult> {
  const fields =
    platform === "instagram"
      ? IG_FIELDS
      : platform === "facebook"
        ? FB_FIELDS
        : null;
  if (!fields) return { ok: false, error: `Unsupported platform: ${platform}` };

  let response: Response;
  try {
    response = await fetch(
      `${GRAPH}/${platformPostId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
  } catch {
    return { ok: false, error: "Network error reaching Meta." };
  }

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const error = body.error as { message?: string; code?: number } | undefined;
  if (error) {
    // The MESSAGE is stored, never the token or the URL. Meta names the missing
    // permission in it, which is exactly what a stale row needs in order to
    // explain itself months later.
    return {
      ok: false,
      error: `Meta ${error.code ?? "?"}: ${(error.message ?? "Unknown error").slice(0, 300)}`,
    };
  }
  if (!response.ok) return { ok: false, error: `Meta HTTP ${response.status}` };

  const insights = parseInsights(platform, body);
  return insights
    ? { ok: true, insights }
    : { ok: false, error: `Unsupported platform: ${platform}` };
}
