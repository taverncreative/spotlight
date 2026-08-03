import { Heart, MessageCircle, Share2 } from "lucide-react";

// Engagement counts on a published social post.
//
// NULL IS NOT ZERO, and this component's whole job is to keep that distinction
// visible. A count we hold is a number; a count Meta will not give us is a
// sentence explaining why, never a blank cell or a nought. Showing "0 likes" for
// a Facebook post would tell John his client's post flopped, when the truth is
// that we asked and were refused.
//
// Facebook likes and comments need pages_read_user_content, which this app does
// not hold and which requires Meta App Review. Instagram likes and comments work
// today on instagram_basic. Verified against the live Graph v25.0 API.

export type TargetInsights = {
  platform: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  fetchedAt: string | null;
  error: string | null;
};

function Metric({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <span className="flex items-center gap-0.5" title={label}>
      {icon}
      <span className="tabular-nums">{value}</span>
      <span className="sr-only"> {label}</span>
    </span>
  );
}

export function PostInsights({ targets }: { targets: TargetInsights[] }) {
  const measured = targets.filter(
    (target) => target.fetchedAt !== null || target.error !== null
  );
  if (measured.length === 0) return null;

  return (
    <div className="space-y-0.5 border-t pt-1.5 text-xs text-muted-foreground">
      {measured.map((target) => {
        const numbers: React.ReactNode[] = [];
        if (target.likes !== null) {
          numbers.push(
            <Metric
              key="likes"
              icon={<Heart aria-hidden="true" className="size-3" />}
              value={target.likes}
              label="likes"
            />
          );
        }
        if (target.comments !== null) {
          numbers.push(
            <Metric
              key="comments"
              icon={<MessageCircle aria-hidden="true" className="size-3" />}
              value={target.comments}
              label="comments"
            />
          );
        }
        if (target.shares !== null) {
          numbers.push(
            <Metric
              key="shares"
              icon={<Share2 aria-hidden="true" className="size-3" />}
              value={target.shares}
              label="shares"
            />
          );
        }

        return (
          <div
            key={target.platform}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="capitalize">{target.platform}</span>
            {target.error ? (
              <span className="text-status-warn">Could not refresh</span>
            ) : numbers.length > 0 ? (
              numbers
            ) : (
              <span>No figures available</span>
            )}
            {/* The explanation, not an empty column. Only shown where something
                is genuinely missing, so it reads as a reason rather than a
                permanent disclaimer. */}
            {target.platform === "facebook" &&
            target.likes === null &&
            !target.error ? (
              <span className="text-muted-foreground/80">
                &mdash; likes and comments need extra Meta permissions
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
