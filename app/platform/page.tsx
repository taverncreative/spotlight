import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { isBehindSchema, readPlatformMetrics } from "@/lib/platform/client";
import { readAge, shortDate, snapshotIsStale } from "@/lib/platform/format";
import { PLATFORM_SCHEMA_VERSION } from "@/lib/platform/types";
import { ConnectionState } from "@/components/platform/connection-state";
import { VerdictBanner } from "@/components/platform/verdict-banner";
import { PlatformLine } from "@/components/platform/platform-line";
import { Aggregates } from "@/components/platform/aggregates";
import { ModuleAdoption } from "@/components/platform/module-adoption";
import { RequestsQueue } from "@/components/platform/requests-queue";
import { WorkspaceRoster } from "@/components/platform/workspace-roster";

// Never prerendered and never cached: the endpoint is no-store, every
// successful call is audited to a platform_reads ledger on BSK View, and a
// stale build of this page would quietly answer "who needs chasing" with last
// week's answer.
export const dynamic = "force-dynamic";

export const metadata = { title: "BSK View platform" };

// A banner about the data itself. NOT a standing caveat: each of these renders
// only when the condition is actually true, so a normal page shows neither.
// They are alarms, and an alarm that is always on is not an alarm.
function Alarm({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-card border border-status-warn/30 bg-status-warn-surface p-3 text-xs leading-relaxed text-status-warn">
      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="max-w-prose">{children}</span>
    </p>
  );
}

export default async function PlatformPage() {
  const read = await readPlatformMetrics();

  // Anything but a successful read renders one clearly-labelled panel and
  // NOTHING ELSE. No stat grid, no zeros, no module bars. A number on this page
  // is a claim we read it, so a failed read gets to make no claims at all.
  if (read.state !== "ok") {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Header />
        <ConnectionState
          state={read.state}
          detail={read.state === "unreachable" ? read.detail : undefined}
        />
      </div>
    );
  }

  const { metrics, readAt } = read;
  const { platform } = metrics;
  const empty = platform.workspaces_total === 0;
  const staleSnapshot = snapshotIsStale(
    platform.sign_in_snapshot_latest_observed_on
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Header />

      <p className="text-xs text-muted-foreground">
        Read {readAge(readAt)} · schema v{metrics.schema_version}
        {platform.sign_in_snapshot_latest_observed_on
          ? ` · sign-in snapshot ${shortDate(platform.sign_in_snapshot_latest_observed_on)}`
          : ""}
      </p>

      {isBehindSchema(metrics) ? (
        <Alarm>
          BSK View is reporting schema v{metrics.schema_version}, older than the
          v{PLATFORM_SCHEMA_VERSION} this console expects. Anything missing
          below is something that deployment cannot report, not something that
          is zero.
        </Alarm>
      ) : null}

      {staleSnapshot ? (
        <Alarm>
          The daily sign-in snapshot has stopped advancing, so every sign-in
          value below is frozen rather than genuinely unchanged.
        </Alarm>
      ) : null}

      {/* The honest zero: a successful read that genuinely found nobody. It
          still shows the aggregates below, because those zeros were actually
          read, unlike the ones a failed read would have invented. */}
      {empty ? <ConnectionState state="empty" /> : null}

      {/* ZONE 1. The answer, before anything that needs reading. */}
      {!empty ? (
        <VerdictBanner workspaces={metrics.workspaces} platform={platform} />
      ) : null}

      {/* The three figures that earn the default view. One line, under the
          answer, above the detail. */}
      {!empty ? (
        <PlatformLine platform={platform} workspaces={metrics.workspaces} />
      ) : null}

      {!empty ? (
        <RequestsQueue platform={platform} workspaces={metrics.workspaces} />
      ) : null}

      {/* ZONE 2, with ZONE 3 inside each line. */}
      {!empty ? (
        <WorkspaceRoster workspaces={metrics.workspaces} platform={platform} />
      ) : null}

      {/* EVERYTHING ELSE, FOLDED. Platform totals and module adoption are the
          answer to a question nobody opens this page holding. MRR and churn are
          a monthly thought, not a Tuesday-morning one, and a platform-wide
          adoption bar at two workspaces is a two-point average of two figures
          already on the lines above. They stay one click away rather than
          taking the top of the screen from the one line that matters. */}
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground">
          Platform totals
        </summary>
        <div className="mt-4 space-y-6">
          <Aggregates platform={platform} />
          <ModuleAdoption platform={platform} />
        </div>
      </details>
    </div>
  );
}

function Header() {
  return (
    <div className="space-y-2">
      {/* The way back. The wordmark goes home too, but this is the one that
          reads as "leave this screen" rather than "go to the top". */}
      <Link
        href="/home"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Clients
      </Link>
      {/* No subtitle. The line below the title used to explain what the page is
          for; the verdict now says what the page is FOR TODAY, and two sentences
          competing for the same spot means neither is read. */}
      <h1 className="text-xl font-semibold tracking-tight">
        BSK View platform
      </h1>
    </div>
  );
}
