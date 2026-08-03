import { Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  buildAttentionList,
  idleModules,
  lastWorkAt,
  type AttentionReason,
} from "@/lib/platform/attention";
import {
  daysAgo,
  moduleLabel,
  planLine,
  shortDate,
} from "@/lib/platform/format";
import type { PlatformWorkspace } from "@/lib/platform/types";

// The reason a row is here, as a chip. Tone comes from the reason, so the
// left-edge colour, the chip and the ordering all agree.
function ReasonPill({ reason }: { reason: AttentionReason }) {
  const status =
    reason.tone === "danger"
      ? "danger"
      : reason.tone === "warn"
        ? "warn"
        : "new";
  return <StatusPill status={status} label={reason.label} />;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="text-muted-foreground">
      {label} <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

// One workspace worth chasing.
//
// The liveness line is the careful part. "Last work" leads, because
// last_quote_created_at / last_invoice_created_at are exact record timestamps
// and mean somebody was genuinely working. The sign-in value sits underneath it,
// labelled "Last signed in properly" and never "last active" or "last seen":
// Supabase moves it on a real credential sign-in only, so a client using BSK
// View every day on a live session can show months of nothing here.
function WorkspaceRow({
  workspace,
  reasons,
}: {
  workspace: PlatformWorkspace;
  reasons: AttentionReason[];
}) {
  const worst = reasons[0]?.tone ?? "info";
  const work = lastWorkAt(workspace);
  const idle = idleModules(workspace);

  return (
    <li
      className={cn(
        "space-y-2.5 rounded-card border border-l-[3px] bg-card p-4",
        worst === "danger" && "border-l-status-danger",
        worst === "warn" && "border-l-status-warn",
        worst === "info" && "border-l-muted-foreground"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{workspace.name}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {planLine(
            workspace.plan_key,
            workspace.billing_period,
            workspace.subscription_status
          )}
        </span>
        {workspace.status !== "active" ? (
          <StatusPill status="warn" label={workspace.status} />
        ) : null}
        {reasons.map((reason) => (
          <ReasonPill key={reason.kind} reason={reason} />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        <Fact label="Signed up" value={`${workspace.age_days} days ago`} />
        <Fact
          label="Members"
          value={
            workspace.members_never_signed_in > 0
              ? `${workspace.members_active} active, ${workspace.members_never_signed_in} never signed in`
              : `${workspace.members_active} active`
          }
        />
        {workspace.members_invited_never_accepted > 0 ? (
          <Fact
            label="Invites unaccepted"
            value={workspace.members_invited_never_accepted}
          />
        ) : null}
        <Fact
          label="Quotes / invoices"
          value={`${workspace.quotes_count} / ${workspace.invoices_count}`}
        />
        {workspace.open_requests > 0 ? (
          <Fact label="Open requests" value={workspace.open_requests} />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        {/* Exact evidence of work, given the weight. */}
        <Fact
          label="Last work"
          value={
            work ? `${work.what}, ${daysAgo(work.at)}` : "nothing recorded"
          }
        />
        {/* Deliberately worded. See the footnote under the list. */}
        <Fact
          label="Last signed in properly"
          value={
            workspace.last_credential_sign_in_at
              ? shortDate(workspace.last_credential_sign_in_at)
              : "never"
          }
        />
        {workspace.onboarding_completed_at === null ? (
          <Fact label="Onboarding" value="not completed" />
        ) : null}
      </div>

      {idle.length > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Switched on but idle:{" "}
          <span className="font-medium text-foreground">
            {idle.map(moduleLabel).join(", ")}
          </span>
        </p>
      ) : null}

      {workspace.owner_email ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            render={<a href={`mailto:${workspace.owner_email}`} />}
          >
            <Mail />
            Chase {workspace.owner_email}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No owner email in the payload, so there is nobody to chase from here.
        </p>
      )}
    </li>
  );
}

export function AttentionList({
  workspaces,
}: {
  workspaces: PlatformWorkspace[];
}) {
  const rows = buildAttentionList(workspaces);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Needs attention</h2>
        <span className="text-xs text-muted-foreground">
          {rows.length === 0
            ? "nobody"
            : `${rows.length} ${rows.length === 1 ? "workspace" : "workspaces"}`}
        </span>
      </div>

      {rows.length === 0 ? (
        // Distinct from every state in ConnectionState: we did read workspaces,
        // and none of them need chasing. Good news, not an empty page.
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          Nothing to chase. Every workspace is subscribed, inside its trial, and
          has somebody working in it.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <WorkspaceRow
              key={row.workspace.organisation_id}
              workspace={row.workspace}
              reasons={row.reasons}
            />
          ))}
        </ul>
      )}

      {/* The one note that stays. Everything else on this screen means what it
          looks like it means; this field does not. It moves on a real sign-in
          only, so a client working in BSK View daily can show months of
          nothing, and read as "last active" it would point the chase at exactly
          the wrong people. */}
      {rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          &ldquo;Last signed in properly&rdquo; moves only on a real sign-in,
          not on a visit. Low is not idle. Last work is the reliable one.
        </p>
      ) : null}
    </section>
  );
}
