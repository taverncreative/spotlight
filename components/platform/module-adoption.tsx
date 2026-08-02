import { moduleLabel } from "@/lib/platform/format";
import type { PlatformAggregates, PlatformFieldNotes } from "@/lib/platform/types";

// Module adoption, with the null-is-not-zero rule drawn rather than described.
//
// A measured module gets a filled bar. An unmeasured one gets a DASHED OUTLINE
// and its own reason, never an empty bar: an empty bar says "nobody uses
// Calendar", and the truth is "Calendar creates no row that could evidence
// using it". A module that reads as unused gets cut, so this distinction has
// consequences beyond tidiness.

function Bar({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-pill bg-muted"
      role="img"
      aria-label={`${pct}% of workspaces`}
    >
      <div className="h-full rounded-pill bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

// Not a bar with zero width. A different mark entirely, because it is a
// different kind of statement.
function NotMeasuredRail() {
  return (
    <div
      className="h-1.5 w-full rounded-pill border border-dashed border-border"
      role="img"
      aria-label="Not measured"
    />
  );
}

export function ModuleAdoption({
  platform,
  notes,
}: {
  platform: PlatformAggregates;
  notes: PlatformFieldNotes;
}) {
  // Measured first, ordered by adoption, then the unmeasured ones grouped at
  // the bottom with their reasons. Interleaving them would invite reading a
  // dashed rail as a low score.
  const measured = platform.modules
    .filter((m) => m.measured)
    .sort((a, b) => (b.adoption_rate ?? 0) - (a.adoption_rate ?? 0));
  const unmeasured = platform.modules.filter((m) => !m.measured);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Module adoption</h2>
        <span className="text-xs text-muted-foreground">
          {platform.workspaces_active} active{" "}
          {platform.workspaces_active === 1 ? "workspace" : "workspaces"}
        </span>
      </div>

      <div className="rounded-card border bg-card p-4">
        {measured.map((m) => {
          const entitled = m.workspaces_entitled;
          const isFloor = m.module === "prospect_finder";
          return (
            <div
              key={m.module}
              className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3 border-t border-border py-2 text-sm first:border-t-0"
            >
              <span className="flex items-center gap-1.5">
                {moduleLabel(m.module)}
                {isFloor ? (
                  <span className="rounded-pill bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    floor
                  </span>
                ) : null}
              </span>
              <Bar fraction={entitled === 0 ? 0 : m.workspaces_enabled / entitled} />
              <span className="text-right text-xs whitespace-nowrap text-muted-foreground">
                {m.workspaces_enabled} of {entitled} on
                {m.workspaces_active_90d !== null
                  ? ` · ${m.workspaces_active_90d} active${isFloor ? " at least" : ""}`
                  : ""}
              </span>
            </div>
          );
        })}

        {unmeasured.map((m) => (
          <div
            key={m.module}
            className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3 border-t border-border py-2 text-sm"
          >
            <span className="flex items-center gap-1.5">
              {moduleLabel(m.module)}
              <span className="rounded-pill bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                not measured
              </span>
            </span>
            <NotMeasuredRail />
            <span className="text-right text-xs whitespace-nowrap text-muted-foreground">
              {m.workspaces_enabled} of {m.workspaces_entitled} on
            </span>
            {/* BSK View's own reason, rendered verbatim. */}
            <p className="col-span-3 text-xs leading-relaxed text-muted-foreground">
              {platform.usage_not_measurable[m.module] ??
                "Usage is not measured for this module."}
            </p>
          </div>
        ))}
      </div>

      <p className="max-w-prose border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
        {notes.module_usage}
      </p>
      <p className="max-w-prose border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
        {notes.enabled_but_idle}
      </p>
    </section>
  );
}
