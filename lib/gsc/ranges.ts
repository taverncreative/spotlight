// Pure (no server-only deps) so both the server fetch layer and the client
// range selector can import these.

export const SEO_RANGES = [
  { key: "7", days: 7, label: "7 days" },
  { key: "28", days: 28, label: "28 days" },
  { key: "90", days: 90, label: "3 months" },
] as const;

export const DEFAULT_RANGE_KEY = "28";

// Falls back to the default for a missing or unknown query param.
export function normalizeRangeKey(key: string | undefined): string {
  return SEO_RANGES.some((range) => range.key === key)
    ? (key as string)
    : DEFAULT_RANGE_KEY;
}

export function rangeDaysFromKey(key: string | undefined): number {
  const match = SEO_RANGES.find(
    (range) => range.key === normalizeRangeKey(key)
  );
  // normalizeRangeKey guarantees a match, but keep a safe fallback.
  return match?.days ?? 28;
}
