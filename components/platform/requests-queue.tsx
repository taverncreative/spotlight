import { ExternalLink } from "lucide-react";
import { daysAgo } from "@/lib/platform/format";
import type {
  PlatformAggregates,
  PlatformRequest,
  PlatformWorkspace,
} from "@/lib/platform/types";

// The requests queue, in whichever of its two shapes the feed allows today.
//
// WITH SUBJECTS (schema v5 onward): the requests themselves, worst-waited
// first, each linking out to BSK View. Subject and age only. The body is never
// carried and never shown: a subject is a label the client chose for a message
// they meant to send us, and a body is free text that may name their own
// customer. Answering happens in BSK View, which is where the conversation
// lives and where the read is audited.
//
// WITHOUT (v4 and earlier): the count, who it is from, and a plain note that
// the contents are not in the feed. Not a broken version of the list above,
// just a smaller true thing, said as such.
//
// It renders nothing at all when both queues are empty. An empty requests block
// on a quiet morning would be a line of prose explaining there is nothing to
// explain.

type Waiting = { request: PlatformRequest; workspace: PlatformWorkspace };

function RequestRow({ request, workspace }: Waiting) {
  return (
    <li className="border-t border-border first:border-t-0 even:bg-muted/20">
      <a
        href={request.url}
        target="_blank"
        rel="noreferrer"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 text-sm transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 font-medium underline-offset-4 hover:underline">
          {request.subject}
        </span>
        <span className="shrink-0 text-muted-foreground">{workspace.name}</span>
        <span className="w-28 shrink-0 text-right text-muted-foreground">
          {daysAgo(request.created_at)}
        </span>
        <ExternalLink
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </a>
    </li>
  );
}

export function RequestsQueue({
  platform,
  workspaces,
}: {
  platform: PlatformAggregates;
  workspaces: PlatformWorkspace[];
}) {
  const ours = platform.requests_awaiting_agency;
  const theirs = platform.requests_awaiting_client;
  if (ours === 0 && theirs === 0) return null;

  // Oldest first: the whole point of showing the age is that a request sitting
  // for three weeks is a different thing from one raised this morning.
  const waiting: Waiting[] = workspaces
    .flatMap((w) =>
      (w.open_request_list ?? [])
        .filter((r) => r.awaiting === "agency")
        .map((request) => ({ request, workspace: w }))
    )
    .sort((a, b) => a.request.created_at.localeCompare(b.request.created_at));

  // Told apart deliberately: no deployment reporting subjects at all is a
  // different statement from one reporting them and finding none.
  const carriesSubjects = workspaces.some(
    (w) => w.open_request_list !== undefined
  );

  const from = workspaces
    .filter((w) => w.open_requests > 0)
    .sort(
      (a, b) =>
        b.open_requests - a.open_requests ||
        a.name.localeCompare(b.name, "en-GB")
    );

  // Who they are from. Named while there are few enough for names to be worth
  // more than a count, which is the same rule the roster runs on; past that the
  // rows below carry the names one by one anyway.
  const sources =
    from.length === 0
      ? "BSK View"
      : from.length <= 3
        ? new Intl.ListFormat("en-GB", {
            style: "long",
            type: "conjunction",
          }).format(from.map((w) => w.name))
        : `${from.length} workspaces`;

  const openTotal = workspaces.reduce((sum, w) => sum + w.open_requests, 0);
  // Both figures come from the same rows on BSK View's side, so they agree
  // unless something is wrong. When they do not, what is listed cannot be
  // trusted to cover the whole queue.
  const disagrees = openTotal !== ours + theirs;

  return (
    // A PANEL, because this is the only thing on the page that is somebody's
    // to do. The accent down the left edge is the one piece of brand colour on
    // the screen and it means "yours": everything else is either a status
    // colour carrying a meaning or no colour at all. The surface is what makes
    // it read as a queue rather than as another sentence.
    <section className="overflow-hidden rounded-card border border-l-[3px] border-l-primary bg-card">
      {/* WHO AND WHAT, NOT HOW MANY. The verdict at the top of the page already
          says how many are waiting on us; repeating it here was the same
          sentence twice, and the second one is the one that had to give. The
          count that survives is the other direction, which the verdict does not
          carry. */}
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border px-4 py-3">
        <span className="font-medium">Requests from {sources}</span>
        {theirs > 0 ? (
          <span className="text-sm text-muted-foreground">
            · {theirs} waiting on them
          </span>
        ) : null}
      </div>

      {carriesSubjects && waiting.length > 0 ? (
        <ul>
          {waiting.map((item) => (
            <RequestRow key={item.request.id} {...item} />
          ))}
        </ul>
      ) : null}

      {/* The subject list and the count disagreeing is its own failure: the
          rows are the thing John acts on, so a short list must never pass for
          the whole queue. */}
      {carriesSubjects && waiting.length !== ours ? (
        <p className="px-4 py-2 text-xs text-status-warn">
          BSK View counts {ours} waiting on us and sent {waiting.length}{" "}
          {waiting.length === 1 ? "subject" : "subjects"}. This list is
          incomplete.
        </p>
      ) : null}

      {disagrees ? (
        <p className="px-4 py-2 text-xs text-status-warn">
          The per-workspace open counts total {openTotal}, which does not match{" "}
          {ours} plus {theirs}. What is listed may not cover the whole queue.
        </p>
      ) : null}

      {/* What John needs, and nothing about why. The architecture behind this
          line lives at the top of this file, where the person changing it will
          read it; on screen it is one fact, and it disappears the moment BSK
          View sends open_request_list. */}
      {!carriesSubjects ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Subjects are not in the feed yet.
        </p>
      ) : null}
    </section>
  );
}
