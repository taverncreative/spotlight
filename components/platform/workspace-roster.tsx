import { ChevronRight, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  buildCohorts,
  buildRoster,
  cohortDisagrees,
  COHORT_THRESHOLD,
  lastWork,
  type RosterLine,
} from "@/lib/platform/roster";
import { reasonsFor, type AttentionKind } from "@/lib/platform/attention";
import { StatusPill } from "@/components/ui/status-pill";
import { daysAgo, moduleLabel, shortDate } from "@/lib/platform/format";
import type {
  PlatformAggregates,
  PlatformWorkspace,
} from "@/lib/platform/types";

// Zones 2 and 3. The roster is one line per workspace; the detail opens on the
// line somebody has actually decided to look at.
//
// WHY A LINE. Everything that used to be on a card is still here, one layer
// down. The card put twelve facts at equal weight, so reading two workspaces
// meant reading twenty-four facts to find the one that mattered. A line carries
// four: who, what they pay, whether anybody is working in it, and whether they
// are waiting on us. Forty workspaces is forty lines and still scans.
//
// WHY <details> AND NOT A ROUTE. Zone 3 is the same data, already fetched, for
// a workspace John has decided to look at. A route would mean a second read of
// an endpoint that audits every read to BSK View's platform_reads ledger, to
// show something we already have.

// Reasons the roster line already carries in its state or signal column.
// Repeating them inside the drill-down would be the density this rebuild is
// removing.
const LINE_REASONS = new Set<AttentionKind>([
  "trial_lapsed",
  "past_due",
  "no_subscription",
  "trial_ending",
]);

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="text-muted-foreground">
      {label} <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

// Zone 3: everything the feed carries about one workspace. Record COUNTS, never
// records: the feed reports that a workspace has four customers and never who
// they are, and this page must not start wanting the difference.
function WorkspaceDetail({ workspace: w }: { workspace: PlatformWorkspace }) {
  const work = lastWork(w);
  const idle = w.modules
    .filter((m) => m.measured && m.enabled_but_idle)
    .map((m) => m.module);

  // The chase reasons that are not already on the line: nobody has signed in,
  // paid modules were never switched on, a request is sitting with them. Real
  // signal, but not what somebody scans a forty-line roster for, so it lives
  // here with the rest of the detail.
  const reasons = reasonsFor(w).filter((r) => !LINE_REASONS.has(r.kind));

  return (
    <div className="space-y-2.5 border-t border-border px-3 py-3 text-[13px]">
      {reasons.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((r) => (
            <StatusPill
              key={r.kind}
              status={
                r.tone === "danger"
                  ? "danger"
                  : r.tone === "warn"
                    ? "warn"
                    : "new"
              }
              label={r.label}
            />
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <Fact label="Signed up" value={shortDate(w.created_at)} />
        <Fact
          label="Last work"
          value={
            work ? `${work.what}, ${daysAgo(work.at)}` : "nothing recorded"
          }
        />
        {/* Never "last active" or "last seen": it moves on a real credential
            sign-in only, so a client working daily on a live session can show
            months of nothing here. */}
        <Fact
          label="Last signed in properly"
          value={
            w.last_credential_sign_in_at
              ? shortDate(w.last_credential_sign_in_at)
              : "never"
          }
        />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <Fact
          label="Members"
          value={
            w.members_never_signed_in > 0
              ? `${w.members_active} active, ${w.members_never_signed_in} never signed in`
              : `${w.members_active} active`
          }
        />
        {w.members_invited_never_accepted > 0 ? (
          <Fact
            label="Invites unaccepted"
            value={w.members_invited_never_accepted}
          />
        ) : null}
        <Fact
          label="Onboarding"
          value={
            w.onboarding_completed_at
              ? shortDate(w.onboarding_completed_at)
              : "not completed"
          }
        />
        {w.onboarding_trade ? (
          <Fact label="Trade" value={w.onboarding_trade} />
        ) : null}
        {w.open_requests > 0 ? (
          <Fact
            label="Requests"
            value={
              w.requests_awaiting_client > 0
                ? `${w.open_requests} open, ${w.requests_awaiting_client} on them`
                : `${w.open_requests} open`
            }
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <Fact
          label="Records"
          value={`${w.leads_count} leads · ${w.customers_count} customers · ${w.quotes_count} quotes · ${w.invoices_count} invoices`}
        />
      </div>

      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">
          {w.modules_enabled_count} of {w.modules_entitled_count} modules on
        </span>
        {w.modules_enabled.length > 0 ? (
          <> · {w.modules_enabled.map(moduleLabel).join(", ")}</>
        ) : null}
      </p>

      {idle.length > 0 ? (
        <p className="text-muted-foreground">
          Switched on but idle:{" "}
          <span className="font-medium text-foreground">
            {idle.map(moduleLabel).join(", ")}
          </span>
        </p>
      ) : null}

      {w.owner_email ? (
        <Button
          variant="outline"
          size="sm"
          render={<a href={`mailto:${w.owner_email}`} />}
        >
          <Mail />
          {w.owner_email}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          No owner email in the payload, so there is nobody to contact from
          here.
        </p>
      )}
    </div>
  );
}

// COLOUR IS SIGNAL HERE, NOT DECORATION, and one meaning per colour across the
// whole page. Gold is paying and healthy -- this palette keeps a warm ramp and
// has no green outside the character counter. Amber is a clock running: a trial
// with days left, a workspace that has gone quiet. Red is money already lost or
// escaping: past due, a lapsed trial, no subscription row at all. Grey is a
// state with nothing to do about it. Nothing else on this screen is coloured,
// so a colour anywhere means somebody should look.
const STATE_PILL: Record<RosterLine["stateTone"], string> = {
  ok: "ok",
  warn: "warn",
  danger: "danger",
  muted: "archived",
};

function Line({ line }: { line: RosterLine }) {
  const w = line.workspace;

  return (
    // A ROW, NOT A PARAGRAPH. Alternate tint, generous vertical rhythm and a
    // pill in a fixed column give the eye a grid to run down. It reads as a
    // table somebody scans, which is also most of what makes it look clickable:
    // rows in a table are things you click, sentences in a box are not.
    <details className="group border-t border-border first:border-t-0 even:bg-muted/20">
      {/* AFFORDANCE. The chevron alone did not read as clickable, so the whole
          row behaves like one control: it lights up on hover, the name
          underlines the way a link does, the chevron colours up and turns, and
          an open row keeps a tint so it is obvious what is expanded.
          focus-visible carries the same weight for the keyboard. */}
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3.5 text-sm transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none group-open:bg-muted/40">
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground group-open:rotate-90"
          aria-hidden
        />
        <span className="min-w-0 flex-1 font-medium underline-offset-4 group-hover:underline">
          {w.name}
        </span>
        {w.status !== "active" ? (
          <StatusPill status="warn" label={w.status} />
        ) : null}
        <StatusPill status={STATE_PILL[line.stateTone]} label={line.state} />
        <span
          className={cn(
            "w-32 shrink-0 text-right text-[13px]",
            line.signalQuiet ? "text-status-warn" : "text-muted-foreground"
          )}
        >
          {line.signal}
        </span>
        <span className="w-14 shrink-0 text-right text-[13px] text-muted-foreground">
          {w.open_requests > 0 ? `${w.open_requests} req` : ""}
        </span>
      </summary>
      <WorkspaceDetail workspace={w} />
    </details>
  );
}

// The cross-check, kept whatever the page is showing. Below the threshold the
// cohort block is not rendered, but the cohorts are still built and still
// compared with BSK View's own figures, because a roster that is quietly
// missing a workspace is the one failure that would make every zone above it
// wrong. Silence here means the two agree, not that nobody looked.
function Reconciliation({
  workspaces,
  platform,
}: {
  workspaces: PlatformWorkspace[];
  platform: PlatformAggregates;
}) {
  const cohorts = buildCohorts(workspaces, platform).filter(cohortDisagrees);
  const rosterShort = workspaces.length !== platform.workspaces_total;

  if (cohorts.length === 0 && !rosterShort) return null;

  return (
    <div className="space-y-1 rounded-card border border-status-warn/30 bg-status-warn-surface p-3 text-xs text-status-warn">
      {rosterShort ? (
        <p>
          BSK View reports {platform.workspaces_total} workspaces and sent{" "}
          {workspaces.length} rows. This list is incomplete.
        </p>
      ) : null}
      {cohorts.map((c) => (
        <p key={c.key}>
          BSK View counts {c.expected} under &ldquo;{c.label}&rdquo;; the
          workspace rows give {c.members.length}. This list is incomplete.
        </p>
      ))}
    </div>
  );
}

// Above the threshold the grouping leads and the roster becomes the drill-down.
function CohortSummary({
  workspaces,
  platform,
}: {
  workspaces: PlatformWorkspace[];
  platform: PlatformAggregates;
}) {
  const cohorts = buildCohorts(workspaces, platform).filter(
    (c) => c.members.length > 0
  );

  return (
    <div className="overflow-hidden rounded-card border bg-card">
      {cohorts.map((c) => (
        // If it says three are on trial, it opens the three. A count that
        // cannot be opened is the fault this whole page was rebuilt to fix,
        // and it does not get to come back at forty workspaces.
        <details
          key={c.key}
          className="group border-t border-border first:border-t-0"
        >
          <summary className="flex cursor-pointer list-none items-baseline gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none group-open:bg-muted/30">
            <ChevronRight
              className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground group-open:rotate-90"
              aria-hidden
            />
            <span className="w-8 shrink-0 font-semibold tabular-nums">
              {c.members.length}
            </span>
            <span className="underline-offset-4 group-hover:underline">
              {c.label}
            </span>
          </summary>
          <ul className="space-y-0.5 border-t border-border px-3 py-2 pl-[3.5rem] text-[13px]">
            {c.members.map(({ workspace, note }) => (
              <li key={workspace.organisation_id}>
                <span className="font-medium">{workspace.name}</span>
                <span className="text-muted-foreground"> — {note}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

export function WorkspaceRoster({
  workspaces,
  platform,
}: {
  workspaces: PlatformWorkspace[];
  platform: PlatformAggregates;
}) {
  const lines = buildRoster(workspaces);
  const grouped = workspaces.length >= COHORT_THRESHOLD;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Workspaces</h2>
        <span className="text-xs text-muted-foreground">{lines.length}</span>
      </div>

      <Reconciliation workspaces={workspaces} platform={platform} />

      {grouped ? (
        <CohortSummary workspaces={workspaces} platform={platform} />
      ) : null}

      {grouped ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
            Every workspace
          </summary>
          <div className="mt-2 overflow-hidden rounded-card border bg-card">
            {lines.map((line) => (
              <Line key={line.workspace.organisation_id} line={line} />
            ))}
          </div>
        </details>
      ) : (
        <div className="overflow-hidden rounded-card border bg-card">
          {lines.map((line) => (
            <Line key={line.workspace.organisation_id} line={line} />
          ))}
        </div>
      )}
    </section>
  );
}
