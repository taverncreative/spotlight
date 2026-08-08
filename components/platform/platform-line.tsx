import { buildRoster, usage, type RosterLine } from "@/lib/platform/roster";
import { ChevronDown } from "lucide-react";
import { pounds } from "@/lib/platform/format";
import { cn } from "@/lib/utils";
import type {
  PlatformAggregates,
  PlatformWorkspace,
} from "@/lib/platform/types";

// Three cards, equal width, under the answer and above the roster.
//
// THE TEST EACH ONE PASSED: would John notice it changing. MRR moving means
// somebody subscribed or cancelled. The workspace count moving is the shape of
// the business. The quiet count moving means a client has stopped working in
// it, and that is the one figure here that nobody writes in to report.
//
// THREE, NOT EIGHT, AND ALL THE SAME SIZE. This is not the stat grid that was
// removed: that grid had eight tiles of mixed importance and this has three
// figures that each pass the test above. Equal width and a fixed three-column
// track are load-bearing, not cosmetic. A grid that reflows into different
// shapes, or one card made wider by a longer label, is what made the last
// version read as leftovers rather than as a summary.
//
// EVERY FIGURE IS A QUANTITY. Same shape, so the eye learns the rhythm once
// and keeps it: money, then a count, then a count. A ratio in words among
// quantities breaks that, which is why "1 of 2 worked in this month" became "1
// gone quiet" with the denominator demoted to the small line underneath. It
// means the same thing and WHICH workspace it is stays on the page: the verdict
// names it above, and its roster row carries the amber below.
//
// COLOUR IS STATE, NEVER DECORATION, and it obeys the same map as the roster
// pills. GOLD, NOT GREEN, is this palette's healthy: the theme keeps a warm
// ramp and its only green is the character counter's, deliberately narrow. Gold
// is money coming in and nobody gone quiet, amber is a clock running, red is
// money escaping, and no colour at all is a count with nothing to feel about
// it, which is why the workspace card is never coloured: two workspaces is not
// good or bad news, it is just how many there are.
//
// Gold and amber are a difference in saturation rather than in kind, as the
// theme file itself warns, so the two cards that can carry them are never
// adjacent: the neutral workspace count sits between them.
//
// NO CHART HERE, AND IT WAS CONSIDERED. A chart earns its place when the shape
// is the information and a number cannot carry it. Two workspaces is two data
// points, and a bar chart of two things is a worse table. The case that will
// genuinely qualify is MRR OVER TWELVE MONTHS, once there is a year of it and
// seasonality is a real question rather than a guess. Two things to know before
// building it: Spotlight stores no MRR history at all today, so it would need
// somewhere to keep a monthly series, and BSK View's own snapshots before
// 6 August 2026 report a twelfth of the truth from the annual-price bug, which
// was corrected forward and never backfilled. A twelve-month line drawn from
// those would show a step change that never happened, and wants annotating at
// that date rather than smoothing.

const FIGURE_TONE = {
  ok: "text-status-ok",
  warn: "text-status-warn",
  danger: "text-status-danger",
  neutral: "text-foreground",
} as const;

// What a card opens: the workspaces its figure counted, each with the one fact
// that figure was about. Name plus what they pay, or name plus how long they
// have been quiet.
type SetMember = { id: string; name: string; fact: string };

// The face of the card, shared by the two versions below so a card that opens
// and a card that cannot are identical until you reach for them.
function Face({
  figure,
  tone,
  label,
  detail,
}: {
  figure: string | number;
  tone: keyof typeof FIGURE_TONE;
  label: string;
  detail: string;
}) {
  return (
    <>
      <p
        className={cn(
          "text-2xl leading-none font-semibold tracking-tight tabular-nums",
          FIGURE_TONE[tone]
        )}
      >
        {figure}
      </p>
      <p className="mt-2 text-xs font-medium underline-offset-4 group-hover:underline">
        {label}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </>
  );
}

function Card({
  figure,
  tone,
  label,
  detail,
  members,
}: {
  figure: string | number;
  tone: keyof typeof FIGURE_TONE;
  label: string;
  detail: string;
  members: SetMember[];
}) {
  // NOTHING BEHIND IT, SO IT DOES NOT PRETEND. An empty set means no hover, no
  // cursor, no chevron: the card is inert and looks inert. "0 gone quiet" that
  // opened onto an empty list would be a worse lie than the unclickable count
  // this page was rebuilt to remove.
  if (members.length === 0) {
    return (
      <div className="rounded-card border bg-card p-4">
        <Face figure={figure} tone={tone} label={label} detail={detail} />
      </div>
    );
  }

  return (
    // AFFORDANCE, HEAVIER THAN THE ROSTER'S because the target is bigger and
    // should look more pressable rather than less: the whole card lifts on
    // hover, its border darkens, the label underlines, and the chevron in the
    // corner turns when it opens. Deliberately no brand colour anywhere here.
    // Brand is the requests panel's, and the difference between a thing to act
    // on and a thing to look at has to survive this.
    <details className="group rounded-card border bg-card transition-colors hover:border-foreground/25 hover:bg-muted/40 open:border-foreground/25 open:bg-muted/20">
      <summary className="relative cursor-pointer list-none p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <ChevronDown
          className="absolute top-4 right-4 size-4 text-muted-foreground transition-transform group-hover:text-foreground group-open:rotate-180"
          aria-hidden
        />
        <Face figure={figure} tone={tone} label={label} detail={detail} />
      </summary>
      <ul className="space-y-1.5 border-t border-border px-4 py-3 text-[13px]">
        {members.map((m) => (
          <li key={m.id}>
            <span className="font-medium">{m.name}</span>
            <span className="block text-muted-foreground">{m.fact}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function PlatformLine({
  platform,
  workspaces,
}: {
  platform: PlatformAggregates;
  workspaces: PlatformWorkspace[];
}) {
  const { working, of } = usage(workspaces);
  const quiet = of - working;
  const atRisk = platform.at_risk_mrr_pence > 0;

  // The sets, built from the same roster lines the table below is built from,
  // so a card and a row can never describe the same workspace differently.
  const lines = buildRoster(workspaces);
  const member = (line: RosterLine, fact: string): SetMember => ({
    id: line.workspace.organisation_id,
    name: line.workspace.name,
    fact,
  });

  // Red MRR leads to the workspaces the money is escaping from, not to the
  // ones paying: the card is red BECAUSE of them, so they are what it owes you
  // when you press it.
  const moneySet = atRisk
    ? lines
        .filter((l) => l.workspace.subscription_status === "past_due")
        .map((l) => member(l, l.state))
    : lines
        .filter((l) => l.workspace.subscription_status === "active")
        .map((l) => member(l, l.state));

  const allSet = lines.map((l) => member(l, l.state));
  const quietSet = lines
    .filter((l) => l.signalQuiet && l.workspace.status !== "archived")
    .map((l) => member(l, l.signal));

  return (
    // items-start so an open card grows downward on its own rather than
    // stretching its two neighbours into tall empty boxes.
    <div className="grid grid-cols-3 items-start gap-2">
      <Card
        figure={pounds(platform.mrr_pence_estimated_from_plan_prices)}
        // Money escaping outranks money arriving: a payment past due makes the
        // headline figure a claim rather than a fact, and the card says so
        // rather than staying gold over the top of it.
        tone={
          atRisk
            ? "danger"
            : platform.mrr_pence_estimated_from_plan_prices > 0
              ? "ok"
              : "neutral"
        }
        label="MRR"
        detail={
          atRisk
            ? `${pounds(platform.at_risk_mrr_pence)} at risk`
            : "per month, estimated"
        }
        members={moneySet}
      />
      <Card
        figure={platform.workspaces_total}
        tone="neutral"
        label="Workspaces"
        detail={`${platform.subscriptions_active} subscribed · ${platform.subscriptions_trialing} trialling`}
        members={allSet}
      />
      <Card
        figure={quiet}
        tone={quiet > 0 ? "warn" : "ok"}
        label="Gone quiet"
        detail={`of ${of}, no work in 30 days`}
        members={quietSet}
      />
    </div>
  );
}
