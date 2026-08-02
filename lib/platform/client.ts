import "server-only";
import {
  PLATFORM_SCHEMA_VERSION,
  type PlatformMetrics,
} from "@/lib/platform/types";

// The one place the platform-metrics token is read, and it is server-only.
//
// THIS IS A THIRD TOKEN, distinct from the outbound one that sends requests into
// BSK View and from BSK_INBOUND_TOKEN that writes a proposal onto a request.
// This one reads across every tenant, so one leak must not grant all three. It
// is deliberately not NEXT_PUBLIC_, this module carries "server-only" so a
// client component importing it fails the build rather than shipping the token,
// and nothing below ever puts the value in a return type, an error message or a
// log line.
const ENDPOINT = "https://bsk-platform.vercel.app/api/spotlight/platform-metrics";

// Four outcomes, kept distinct all the way to the screen, because John needs to
// tell them apart at a glance when the answer is "nothing here":
//
//   ok            - the read succeeded. Zero workspaces is a real answer.
//   unconfigured  - we have no token. Our setup problem, not BSK View's.
//   refused       - 401. The endpoint FAILS CLOSED and is working correctly;
//                   the token is wrong, revoked, or unset on BSK View's side.
//                   The body is identical in all three cases by design, so we
//                   cannot narrow it further and must not pretend to.
//   unreachable   - anything else: network error, 5xx, unparseable body.
//
// Collapsing these into "no data" would render a zero we cannot stand behind.
// Nothing but `ok` is ever allowed to put a number on the screen.
export type PlatformRead =
  | { state: "ok"; metrics: PlatformMetrics; readAt: string }
  | { state: "unconfigured" }
  | { state: "refused" }
  | { state: "unreachable"; detail: string };

// Ten seconds. A slow platform read should degrade to the "unreachable" panel
// rather than hanging the operator's page.
const TIMEOUT_MS = 10_000;

export async function readPlatformMetrics(): Promise<PlatformRead> {
  const token = process.env.PLATFORM_METRICS_TOKEN;
  if (!token) return { state: "unconfigured" };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
      // The endpoint sends Cache-Control: no-store and audits every successful
      // call to a platform_reads ledger on BSK View. Caching here would make
      // that ledger lie about when we actually looked, and the whole point of
      // the screen is that it is current.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Never interpolate the token; a fetch error message can carry the request
    // URL but not our header, and we only pass the message through.
    const detail =
      error instanceof Error && error.name === "TimeoutError"
        ? `No response within ${TIMEOUT_MS / 1000} seconds`
        : error instanceof Error
          ? error.message
          : "Network request failed";
    return { state: "unreachable", detail };
  }

  if (response.status === 401) return { state: "refused" };

  if (!response.ok) {
    return {
      state: "unreachable",
      detail: `BSK View answered HTTP ${response.status}`,
    };
  }

  let metrics: PlatformMetrics;
  try {
    metrics = (await response.json()) as PlatformMetrics;
  } catch {
    return { state: "unreachable", detail: "The response was not valid JSON" };
  }

  // A shape check, not a schema validation: if the two branches the whole page
  // reads are absent, treat it as unreachable rather than rendering a page of
  // undefined. Version drift is reported by the page, not rejected here: a
  // LOWER schema_version means that deployment cannot report some things, which
  // is a different statement from those things being zero, and the page says so.
  if (
    typeof metrics?.schema_version !== "number" ||
    !metrics.platform ||
    !Array.isArray(metrics.workspaces)
  ) {
    return {
      state: "unreachable",
      detail: "The response did not carry a platform metrics payload",
    };
  }

  return { state: "ok", metrics, readAt: new Date().toISOString() };
}

// True when the deployment we read is older than the schema this console was
// built against, i.e. it may be unable to report things we ask for. Newer is
// not a problem: unknown extra fields are ignored.
export function isBehindSchema(metrics: PlatformMetrics): boolean {
  return metrics.schema_version < PLATFORM_SCHEMA_VERSION;
}
