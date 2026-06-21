import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPence } from "@/lib/currency";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { loadDashboard } from "./dashboard-data";

// The workspace home is a read-only dashboard (Phase 12): the key numbers from
// across the modules at a glance, with the things needing action made obvious.
// Every figure comes from loadDashboard (efficient, entitlement-aware queries
// reusing the existing helpers); this file only presents them. read_only members
// see the whole dashboard, since it is read-only for everyone.

function StatCard({
  href,
  title,
  testId,
  children,
}: {
  href: string;
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="block rounded-xl border bg-card p-5 shadow-soft transition-colors hover:border-brand/30 hover:bg-accent/40"
    >
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="mt-2 space-y-1">{children}</div>
    </Link>
  );
}

function Figure({
  value,
  label,
  testId,
}: {
  value: string;
  label: string;
  testId: string;
}) {
  return (
    <p className="flex items-baseline gap-2">
      <span
        data-testid={testId}
        className="text-3xl font-medium tracking-tight tabular-nums"
      >
        {value}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </p>
  );
}

function formatDueDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { organisation } = await requireWorkspaceAccess(orgSlug);

  const supabase = await createClient();
  const { data: entitlements } = await supabase
    .from("organisation_entitlements")
    .select("module")
    .eq("organisation_id", organisation.id);
  const enabledModules = (entitlements ?? []).map((row) => row.module);

  const data = await loadDashboard(orgSlug, organisation.id, enabledModules);

  const base = `/app/${orgSlug}`;
  const { overdueTasks, unansweredQuotes } = data.attention;
  const hasAttention = overdueTasks.length > 0 || unansweredQuotes.length > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">
          {organisation.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An overview of your workspace.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.leads ? (
          <StatCard href={`${base}/leads`} title="Leads" testId="card-leads">
            <Figure
              value={String(data.leads.open)}
              label="open"
              testId="dash-leads-open"
            />
            <p className="text-sm text-muted-foreground">
              <span data-testid="dash-leads-last7">{data.leads.last7}</span> new
              in the last 7 days
            </p>
          </StatCard>
        ) : null}

        {data.customers ? (
          <StatCard
            href={`${base}/customers`}
            title="Customers"
            testId="card-customers"
          >
            <Figure
              value={String(data.customers.total)}
              label="customers"
              testId="dash-customers-total"
            />
          </StatCard>
        ) : null}

        {data.quotes ? (
          <StatCard href={`${base}/quotes`} title="Quotes" testId="card-quotes">
            <Figure
              value={String(data.quotes.open)}
              label="open"
              testId="dash-quotes-open"
            />
            <p className="text-sm text-muted-foreground">
              <span data-testid="dash-quotes-value">
                {formatPence(data.quotes.openValuePence)}
              </span>{" "}
              in open quotes
            </p>
            <p className="text-sm text-muted-foreground">
              <span data-testid="dash-quotes-accepted30">
                {data.quotes.accepted30}
              </span>{" "}
              accepted in the last 30 days
            </p>
          </StatCard>
        ) : null}

        {data.tasks ? (
          <StatCard href={`${base}/tasks`} title="Tasks" testId="card-tasks">
            <Figure
              value={String(data.tasks.open)}
              label="open"
              testId="dash-tasks-open"
            />
            {data.tasks.overdue > 0 ? (
              <p className="text-sm font-medium text-destructive">
                <span data-testid="dash-tasks-overdue">
                  {data.tasks.overdue}
                </span>{" "}
                overdue
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                <span data-testid="dash-tasks-overdue">0</span> overdue
              </p>
            )}
          </StatCard>
        ) : null}

        {data.savings ? (
          <StatCard
            href={`${base}/savings`}
            title="Savings"
            testId="card-savings"
          >
            <Figure
              value={formatPence(data.savings.monthlyPence)}
              label="saved per month"
              testId="dash-savings-monthly"
            />
          </StatCard>
        ) : null}
      </div>

      <section aria-label="Needs attention" className="space-y-3">
        <h2 className="text-lg font-medium tracking-tight">Needs attention</h2>
        {hasAttention ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {overdueTasks.length > 0 ? (
              <div
                data-testid="attention-overdue-tasks"
                className="rounded-xl border border-destructive/30 bg-destructive/10 p-4"
              >
                <Link
                  href={`${base}/tasks?overdue=1`}
                  className="text-sm font-medium text-destructive underline-offset-4 hover:underline"
                >
                  Overdue tasks
                </Link>
                <ul className="mt-2 space-y-1">
                  {overdueTasks.map((task) => (
                    <li key={task.id} className="text-sm text-foreground">
                      {task.title}
                      {task.due_at ? (
                        <span className="text-muted-foreground">
                          {" "}
                          (due {formatDueDate(task.due_at)})
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {unansweredQuotes.length > 0 ? (
              <div
                data-testid="attention-unanswered-quotes"
                className="rounded-xl border bg-card p-4 shadow-soft"
              >
                <Link
                  href={`${base}/quotes?status=sent`}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  Quotes awaiting a response
                </Link>
                <ul className="mt-2 space-y-1">
                  {unansweredQuotes.map((quote) => (
                    <li key={quote.id} className="text-sm">
                      Quote #{quote.quote_number}
                      {quote.title ? ` ${quote.title}` : ""}{" "}
                      <span className="text-muted-foreground">
                        ({formatPence(quote.total_pence)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing needs attention right now.
          </p>
        )}
      </section>
    </div>
  );
}
