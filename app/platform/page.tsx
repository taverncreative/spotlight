import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { isBehindSchema, readPlatformMetrics } from "@/lib/platform/client";
import { readAge, shortDate, snapshotIsStale } from "@/lib/platform/format";
import { PLATFORM_SCHEMA_VERSION } from "@/lib/platform/types";
import { ConnectionState } from "@/components/platform/connection-state";
import { AttentionList } from "@/components/platform/attention-list";
import { Aggregates } from "@/components/platform/aggregates";
import { ModuleAdoption } from "@/components/platform/module-adoption";

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

      {!empty ? <AttentionList workspaces={metrics.workspaces} /> : null}

      <Aggregates platform={platform} />

      <ModuleAdoption platform={platform} />
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
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          BSK View platform
        </h1>
        <p className="text-sm text-muted-foreground">
          Who needs chasing, read live from BSK View.
        </p>
      </div>
    </div>
  );
}
