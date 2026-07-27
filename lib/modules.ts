// The Spotlight client modules, in bottom-bar order. Each maps a route segment
// under /c/[clientSlug] to its tab label. "business" is the Google Business
// Profile module. The real module views fill in from later slices.
export type ClientModule = { segment: string; label: string };

export const CLIENT_MODULES: ClientModule[] = [
  { segment: "overview", label: "Overview" },
  { segment: "tasks", label: "Tasks" },
  { segment: "seo", label: "SEO" },
  { segment: "analytics", label: "Analytics" },
  { segment: "business", label: "Business" },
  { segment: "blog", label: "Blog" },
  { segment: "social", label: "Social" },
  // Requests carries print orders as a section rather than Print having its own
  // tab: both are inbound work the client asked for, and one of them arrives
  // rarely enough that a permanent tab mostly showed an empty state.
  { segment: "requests", label: "Requests" },
  // Last: configuration you set once, unlike the modules above it.
  { segment: "settings", label: "Settings" },
];
