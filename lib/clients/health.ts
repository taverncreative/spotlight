// The neglect score behind a client's health bar.
//
// A PURE function over already-gathered numbers: no database, no clock, no React.
// The caller passes "now" and the inputs it read, so the same inputs always give
// the same score and the whole thing is testable without a browser, which is
// otherwise the one thing this rebuild has had no way to check.
//
// THE PROBLEM IT SOLVES. A client we have never done social for has zero
// scheduled posts, and so does a client whose social has been neglected for a
// month. Scoring both the same is the failure mode; scoring only the services a
// client is actually on (clients.services, 0061) is the fix.
//
// Retainer is deliberately not an input. Under-use of a retainer is ambiguous:
// an efficient month and a neglected one look identical, and a score that cannot
// tell them apart is worse than one that stays quiet.

export const SERVICES = ["monitoring", "blog", "social", "requests"] as const;
export type Service = (typeof SERVICES)[number];

export function isService(value: string): value is Service {
  return (SERVICES as readonly string[]).includes(value);
}

export const SERVICE_LABELS: Record<Service, string> = {
  monitoring: "Monitoring",
  blog: "Blog",
  social: "Social",
  requests: "Requests",
};

// Weights are relative, not percentages: the divisor is whatever applies to this
// client, so these only ever express "how much worse is X than Y".
//
// requests is heaviest because a client waiting on a reply is the most visible
// neglect there is, and the only one they can see themselves. monitoring is
// lightest because a site going down is already surfaced loudly elsewhere; its
// place here is to stop a healthy client scoring badly on cadence alone.
export const WEIGHTS: Record<Service, number> = {
  requests: 3,
  social: 2,
  blog: 2,
  monitoring: 1,
};

// Thresholds, in one place so they can be argued with. Each is the point at
// which that service scores zero.
export const THRESHOLDS = {
  // An open request older than this is fully neglected.
  requestDays: 7,
  // Scheduled social runway. This far ahead or more is a full score.
  socialRunwayDays: 14,
  // A post is expected roughly monthly; twice that with nothing is a zero.
  blogCadenceDays: 30,
} as const;

export type HealthInput = {
  services: string[];
  // Age in days of the oldest OPEN request, or null when none are open.
  oldestOpenRequestDays: number | null;
  // Days until the last scheduled social post, or null when nothing is queued.
  socialRunwayDays: number | null;
  // Days since the most recent published post, or null when there are none.
  daysSinceLastPost: number | null;
  // Worst site state across the client's monitored sites.
  siteState: "healthy" | "at-risk" | "down" | null;
};

export type HealthResult = {
  // 0 is fully neglected, 1 is fine. null when no service applies, which is not
  // a score of zero and must not render as one.
  score: number | null;
  // Per-service contributions, for explaining the number rather than just
  // showing it.
  parts: { service: Service; value: number; weight: number }[];
};

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// Each scorer returns 0 (neglected) to 1 (fine), or null when the input cannot
// answer. null means "applies, but nothing to judge yet", and is treated as a
// full score rather than a zero: a client on blog who has never had a post is
// not being neglected, they are being started.
function scoreRequests(input: HealthInput): number | null {
  if (input.oldestOpenRequestDays === null) return 1;
  return clamp01(1 - input.oldestOpenRequestDays / THRESHOLDS.requestDays);
}

function scoreSocial(input: HealthInput): number | null {
  if (input.socialRunwayDays === null) return 0;
  return clamp01(input.socialRunwayDays / THRESHOLDS.socialRunwayDays);
}

function scoreBlog(input: HealthInput): number | null {
  if (input.daysSinceLastPost === null) return null;
  const overdueBy = input.daysSinceLastPost - THRESHOLDS.blogCadenceDays;
  if (overdueBy <= 0) return 1;
  return clamp01(1 - overdueBy / THRESHOLDS.blogCadenceDays);
}

function scoreMonitoring(input: HealthInput): number | null {
  if (input.siteState === null) return null;
  if (input.siteState === "down") return 0;
  if (input.siteState === "at-risk") return 0.4;
  return 1;
}

const SCORERS: Record<Service, (input: HealthInput) => number | null> = {
  requests: scoreRequests,
  social: scoreSocial,
  blog: scoreBlog,
  monitoring: scoreMonitoring,
};

// The weighted mean over APPLICABLE services only.
//
// The divisor is the sum of the weights that applied, not a fixed total, which
// is what stops a client on two services being marked down against one on four.
// Two applicable services are scored out of two.
export function healthScore(input: HealthInput): HealthResult {
  // Deduped, because 0061's check constraint cannot reject a repeated element
  // and a weighted mean counting one service twice would be quietly wrong.
  const applicable = [...new Set(input.services)].filter(isService);

  const parts: HealthResult["parts"] = [];
  for (const service of applicable) {
    const value = SCORERS[service](input);
    // null means the service applies but has nothing to judge yet. It is left
    // out of both sides of the mean rather than scored, so a brand-new client
    // does not read as neglected for having no history.
    if (value === null) continue;
    parts.push({ service, value, weight: WEIGHTS[service] });
  }

  if (parts.length === 0) return { score: null, parts: [] };

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const weighted = parts.reduce(
    (sum, part) => sum + part.value * part.weight,
    0
  );
  return { score: clamp01(weighted / totalWeight), parts };
}
