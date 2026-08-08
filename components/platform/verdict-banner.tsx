import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildVerdict } from "@/lib/platform/verdict";
import type {
  PlatformAggregates,
  PlatformWorkspace,
} from "@/lib/platform/types";

// Zone 1. The answer, in one line, above everything.
//
// The clear state is deliberately the quietest thing on the page rather than a
// green celebration: it is the normal morning, and it should read as "carry on"
// in half a second. The concern state names one workspace, because a headline
// that names three is a list, and the list is the next zone down.

export function VerdictBanner({
  workspaces,
  platform,
}: {
  workspaces: PlatformWorkspace[];
  platform: PlatformAggregates;
}) {
  const verdict = buildVerdict(workspaces, platform);

  if (verdict.state === "clear") {
    return (
      <p className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <Check className="size-4 shrink-0 text-status-ok" aria-hidden />
        {verdict.line}
      </p>
    );
  }

  const { headline, others } = verdict;

  return (
    <div className="space-y-1">
      <p
        className={cn(
          "flex items-start gap-2 text-xl font-semibold tracking-tight",
          headline.tone === "danger" ? "text-status-danger" : "text-foreground"
        )}
      >
        <AlertTriangle
          className={cn(
            "mt-1.5 size-4 shrink-0",
            headline.tone === "danger"
              ? "text-status-danger"
              : "text-status-warn"
          )}
          aria-hidden
        />
        {headline.line}
      </p>
      {/* Nothing is hidden by leading with one. The count says how much more
          there is, and the roster below names all of it. */}
      {others > 0 ? (
        <p className="pl-6 text-xs text-muted-foreground">
          and {others} {others === 1 ? "other thing" : "other things"} below
        </p>
      ) : null}
    </div>
  );
}
