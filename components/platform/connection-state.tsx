import { CircleSlash, KeyRound, ShieldX, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";

// The four ways this screen can have nothing to show, drawn so they cannot be
// mistaken for one another.
//
// WHY THIS COMPONENT EXISTS. "No workspaces yet", "we never set the token",
// "BSK View refused the token" and "BSK View did not answer" all end in an
// empty page, and they need completely different responses: wait, configure,
// re-issue, investigate. An empty page cannot tell John which he is looking at,
// so each gets its own icon, colour, heading and next step.
//
// THE RULE THAT MATTERS: only the "connected" state ever renders a number. A
// failure state shows no counts at all, because a zero we did not actually read
// is a lie, and this screen exists to be trusted about small numbers.

type Props = {
  state: "unconfigured" | "refused" | "unreachable" | "empty";
  // Only for "unreachable": what actually went wrong. Never carries the token.
  detail?: string;
};

const PANELS = {
  // Our own setup gap. Neutral, because nothing is broken and nobody needs
  // alarming: the console has simply never been given the credential.
  unconfigured: {
    Icon: KeyRound,
    tone: "border-border bg-card text-muted-foreground",
    iconTone: "text-muted-foreground",
    heading: "Not connected to BSK View",
    body: "PLATFORM_METRICS_TOKEN is not set on this deployment, so nothing has been read. No figures are shown below because none were fetched, not because they are zero.",
    next: "Add the token to this project's environment and reload.",
  },
  // BSK View answered, correctly, with a refusal. Amber: it is a credential
  // problem to fix, not an outage to investigate.
  refused: {
    Icon: ShieldX,
    tone: "border-status-warn/30 bg-status-warn-surface text-status-warn",
    iconTone: "text-status-warn",
    heading: "BSK View refused the token",
    body: "The endpoint answered 401. It fails closed and returns an identical response whether the token is missing, wrong, or unset on BSK View's side, so it cannot be narrowed further from here. This is the route working correctly, not a broken integration.",
    next: "Check the token matches the one BSK View holds, and that BSK View's own secret is set.",
  },
  // Nobody answered, or answered with something we cannot read. Red: this one
  // is worth looking into.
  unreachable: {
    Icon: Unplug,
    tone: "border-status-danger/30 bg-status-danger-surface text-status-danger",
    iconTone: "text-status-danger",
    heading: "Could not reach BSK View",
    body: "The read did not complete, so this page has no figures to show. This is not a statement about the platform: workspaces, MRR and trials are unknown right now, not zero.",
    next: "Try again shortly. If it persists, check BSK View is deployed and healthy.",
  },
  // The honest zero. Gold rather than grey, because a successful read is a
  // good outcome and this is the state John is waiting to watch tick over.
  empty: {
    Icon: CircleSlash,
    tone: "border-status-ok/30 bg-status-ok-surface text-status-ok",
    iconTone: "text-status-ok",
    heading: "Read succeeded. No workspaces yet.",
    body: "BSK View answered normally and reported zero workspaces. This is a real answer, not a failed read: the platform genuinely has nobody on it yet.",
    next: "Sign up the first workspace and this becomes 1.",
  },
} as const;

export function ConnectionState({ state, detail }: Props) {
  const panel = PANELS[state];
  const { Icon } = panel;

  return (
    <section
      className={cn("rounded-card border p-6", panel.tone)}
      aria-live="polite"
    >
      <div className="flex gap-4">
        <Icon className={cn("mt-0.5 size-5 shrink-0", panel.iconTone)} aria-hidden />
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            {panel.heading}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {panel.body}
          </p>
          {detail ? (
            <p className="font-mono text-xs text-muted-foreground">{detail}</p>
          ) : null}
          <p className="text-sm text-foreground/80">{panel.next}</p>
        </div>
      </div>
    </section>
  );
}
