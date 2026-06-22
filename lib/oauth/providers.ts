// Registry of the Google products Spotlight can connect. Each maps to its
// oauth_connections provider value (the object key) and the API scope it needs.
// openid + email are always requested so we can read the connected account.

export const GOOGLE_PROVIDERS = {
  google_search_console: {
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    label: "Google Search Console",
  },
  google_analytics: {
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    label: "Google Analytics 4",
  },
} as const;

export type GoogleProvider = keyof typeof GOOGLE_PROVIDERS;

export const GOOGLE_PROVIDER_KEYS = Object.keys(
  GOOGLE_PROVIDERS
) as GoogleProvider[];

// The original GSC connect defaults here when no provider param is supplied.
export const DEFAULT_GOOGLE_PROVIDER: GoogleProvider = "google_search_console";

export function isGoogleProvider(
  value: string | null | undefined
): value is GoogleProvider {
  return (
    value != null &&
    Object.prototype.hasOwnProperty.call(GOOGLE_PROVIDERS, value)
  );
}

// Full scope set sent to Google for a provider: account identity + the product.
export function scopesFor(provider: GoogleProvider): string[] {
  return ["openid", "email", GOOGLE_PROVIDERS[provider].scope];
}
