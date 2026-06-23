import "server-only";

// The app's public base URL — the ngrok tunnel in dev, the deployed origin in
// prod. Read from APP_BASE_URL so server-side redirects and OAuth redirect URIs
// resolve to the public origin, not the localhost the dev server binds to.
//
// Why this exists: behind a proxy (ngrok), Next.js resolves a route handler's
// `request.url` to the bind host (localhost:3100) while honouring the forwarded
// `https` proto, so `new URL(path, request.url)` yields `https://localhost:3100/…`
// and the browser fails with an SSL error. Building redirects from this base
// keeps them on the tunnel/deployed origin instead. Falls back to localhost when
// APP_BASE_URL is unset (plain local dev, where the origin already is localhost).
export function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3100";
}

// Absolute URL on the app's public origin for a path, e.g.
// appUrl("/settings/integrations").
export function appUrl(path: string): URL {
  return new URL(path, appBaseUrl());
}
