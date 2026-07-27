// The Spotlight client modules, in bottom-bar order. Each maps a route segment
// under /c/[clientSlug] to its tab label. "business" is the Google Business
// Profile module. The real module views fill in from later slices.
export type ClientModule = { segment: string; label: string };

export const CLIENT_MODULES: ClientModule[] = [
  { segment: "overview", label: "Overview" },
  // Requests and Print used to be operator-level pages. They are per-client
  // work: an inbound request is FOR someone. Requests sits before Tasks because
  // it is what the client asked for, and Tasks is what we decided to do.
  { segment: "requests", label: "Requests" },
  { segment: "tasks", label: "Tasks" },
  { segment: "print-orders", label: "Print" },
  { segment: "seo", label: "SEO" },
  { segment: "analytics", label: "Analytics" },
  { segment: "business", label: "Business" },
  { segment: "blog", label: "Blog" },
  { segment: "social", label: "Social" },
];
