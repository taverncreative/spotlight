import { AlertTriangle } from "lucide-react";
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

// A one-line banner about the data itself, not about a workspace. Used for the
// two ways the payload can be quietly less trustworthy than it looks.
function Caveat({ children }: { children: React.ReactNode }) {
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
  const { platform, field_notes: notes } = metrics;
  const empty = platform.workspaces_total === 0;
  const staleSnapshot = snapshotIsStale(
    platform.sign_in_snapshot_latest_observed_on
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Header />

      <p className="text-xs text-muted-foreground">
        Read {readAge(readAt)} · generated {shortDate(metrics.generated_at)} ·
        schema v{metrics.schema_version}
        {platform.sign_in_snapshot_latest_observed_on
          ? ` · sign-in snapshot ${shortDate(platform.sign_in_snapshot_latest_observed_on)}`
          : ""}
      </p>

      {isBehindSchema(metrics) ? (
        <Caveat>
          BSK View is reporting schema v{metrics.schema_version}, older than the
          v{PLATFORM_SCHEMA_VERSION} this console was built against. Anything
          missing below is something that deployment cannot report, which is not
          the same as it being zero.
        </Caveat>
      ) : null}

      {staleSnapshot ? (
        <Caveat>{notes.sign_in_snapshot_observed_on}</Caveat>
      ) : null}

      {/* The honest zero: a successful read that genuinely found nobody. It
          still shows the aggregates below, because those zeros were actually
          read, unlike the ones a failed read would have invented. */}
      {empty ? <ConnectionState state="empty" /> : null}

      {!empty ? (
        <AttentionList
          workspaces={metrics.workspaces}
          signInNote={notes.last_credential_sign_in_at}
        />
      ) : null}

      <Aggregates platform={platform} notes={notes} />

      <ModuleAdoption platform={platform} notes={notes} />

      <p className="max-w-prose border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
        {notes.counts} This endpoint returns no client PII at all: no customer
        records, no quote or invoice contents or totals, no request bodies, and
        no email address except the workspace owner&rsquo;s.
      </p>
    </div>
  );
}

function Header() {
  return (
    <div className="space-y-1">
      <h1 className="text-xl font-semibold tracking-tight">
        BSK View platform
      </h1>
      <p className="text-sm text-muted-foreground">
        Who needs chasing, read live from BSK View.
      </p>
    </div>
  );
}
