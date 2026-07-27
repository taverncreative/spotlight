// The per-client counts shown on the home cards, and their zero value.
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
