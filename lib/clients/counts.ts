// The per-client data the home cards render: the five counts on the card face,
// and the detail the expanded view shows underneath them.
//
// A PLAIN module on purpose, with no "use client". These were originally
// exported from components/client-grid.tsx, which is a client component, and
// app/home/page.tsx imported ZERO_COUNTS from there. Across that boundary Next
// does not hand the server the real object: it substitutes a client reference,
// so `{ ...ZERO_COUNTS }` spread to `{}`, every `count++` produced NaN, and
// `NaN > 0` filtered every chip out. Cards rendered, counters never did, and
// nothing errored: tsc sees correct types on both sides, because the types are
// erased and only the runtime value is replaced.
//
// Living here, both sides import the real thing. Anything shared between a
// server component and a client component belongs in a module like this rather
// than being re-exported from whichever component happened to define it first.

export type ClientCounts = {
  requests: number;
  tasks: number;
  printOrders: number;
  social: number;
  blog: number;
};

export const ZERO_COUNTS: ClientCounts = {
  requests: 0,
  tasks: 0,
  printOrders: 0,
  social: 0,
  blog: 0,
};

// The rows behind three of the five counters. Requests and print orders have no
// detail here on purpose: every one of them is currently unlinked, so there is
// nothing to show under a client. They get their own view in the orphan slice.
export type TaskItem = { id: string; title: string; due_date: string | null };
export type SocialItem = {
  id: string;
  caption: string | null;
  scheduled_at: string | null;
};
export type BlogItem = {
  id: string;
  title: string;
  published_at: string | null;
};

// Everything one card needs, counts and detail together, so the two cannot
// drift: tasks/social/blog counts ARE the lengths of these arrays. Only requests
// and printOrders come from separate count-only queries.
export type ClientCardData = {
  counts: ClientCounts;
  tasks: TaskItem[];
  social: SocialItem[];
  blog: BlogItem[];
};

// counts is its own literal rather than a reference to ZERO_COUNTS. Sharing the
// object would mean every card that fell back to this fallback aliased the same
// counts, so one stray mutation anywhere would rewrite the constant for all of
// them. Nothing mutates it today; this makes that impossible rather than lucky.
export const EMPTY_CARD_DATA: ClientCardData = {
  counts: { requests: 0, tasks: 0, printOrders: 0, social: 0, blog: 0 },
  tasks: [],
  social: [],
  blog: [],
};
