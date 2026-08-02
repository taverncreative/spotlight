// Formatting for the platform screen. Pure, so the awkward cases (null money,
// a date that is null because nothing has happened) are tested rather than
// guessed at in JSX.

// Integer pence to pounds. Whole pounds lose the ".00", because a column of
// "£3.75 / £95.00 / £1,140.00" reads worse than "£3.75 / £95 / £1,140".
export function pounds(pence: number): string {
  const value = pence / 100;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// "3 days ago", "today". Used for evidence timestamps, where the gap matters
// more than the date itself.
export function daysAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// How long ago the read happened, for the freshness line. Seconds matter here:
// the page is a live read and "just now" is the normal answer.
export function readAge(iso: string, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

// BSK View module keys to the names John would say out loud. An unknown key
// falls back to a de-slugged version rather than throwing, so a module added on
// BSK View's side appears with a sensible label before this map is updated.
const MODULE_LABELS: Record<string, string> = {
  leads: "Leads",
  customers: "Customers",
  quotes: "Quotes",
  tasks: "Tasks",
  jobs: "Jobs",
  calendar: "Calendar",
  invoicing: "Invoicing",
  subscription_savings: "Subscription savings",
  reviews: "Reviews",
  templates: "Templates",
  automations: "Automations",
  marketing: "Marketing",
  email_marketing: "Email marketing",
  prospect_finder: "Prospect Finder",
  requests: "Requests",
  expenses: "Expenses",
  sops: "SOPs",
  planning: "Planning",
  files: "Files",
};

export function moduleLabel(key: string): string {
  return (
    MODULE_LABELS[key] ??
    key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

// The plan line: "autopilot · annual". A null billing_period is treated as
// monthly by BSK View's MRR estimate, so we say monthly rather than leaving a
// gap that implies we do not know.
export function planLine(
  planKey: string | null,
  billingPeriod: string | null,
  subscriptionStatus: string | null
): string {
  if (!planKey) return "no plan";
  const period = billingPeriod ?? "monthly";
  const status =
    subscriptionStatus && subscriptionStatus !== "active"
      ? ` · ${subscriptionStatus.replace(/_/g, " ")}`
      : "";
  return `${planKey} · ${period}${status}`;
}

// The daily sign-in snapshot is expected to advance every day. Two days without
// it means the cron has stopped and every sign-in value in the payload is
// frozen rather than genuinely unchanged, which is a different claim.
const SNAPSHOT_STALE_AFTER_DAYS = 2;

export function snapshotIsStale(
  observedOn: string | null,
  now: Date = new Date()
): boolean {
  if (!observedOn) return true;
  const observed = new Date(`${observedOn}T00:00:00.000Z`);
  const days = Math.floor((now.getTime() - observed.getTime()) / 86_400_000);
  return days > SNAPSHOT_STALE_AFTER_DAYS;
}
