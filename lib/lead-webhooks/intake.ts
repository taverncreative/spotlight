// Shared pieces for the public lead-intake endpoint (app/api/lead-webhooks).
// Pure helpers and constants, no server-only imports, so the form-management
// pass can reuse the honeypot field name and limits when it renders the embed
// snippet.

// The honeypot field name. The hosted form renders this as a hidden input
// real users never see; a bot that fills every field trips it. A namespaced
// name keeps it from colliding with a genuine submission field.
export const HONEYPOT_FIELD = "_bsk_hp";

// Fixed-window rate limit, enforced in Postgres (see webhook_rate_limit_hit
// in migration 0019). The window and the two ceilings are policy and live
// here in code; the database holds only the mechanism. Deliberately modest:
// a single lead form, or a single source address, exceeding these per minute
// is abuse, not normal traffic.
export const RATE_WINDOW_SECONDS = 60;
export const TOKEN_RATE_LIMIT = 8;
export const IP_RATE_LIMIT = 8;

// A lead submission is small; anything larger is rejected before it is read
// into memory or parsed.
export const MAX_BODY_BYTES = 16 * 1024;

// The submission fields surfaced as lead columns. The single source of these
// names: mapSubmission reads them and buildExampleFormHtml renders an input
// for each, so the example form can never drift from what the endpoint maps.
export const MAPPED_FIELDS = ["name", "email", "phone", "message"] as const;

type MappedField = (typeof MAPPED_FIELDS)[number];
type Mapped = Record<MappedField, string | null>;

// Map the recognised fields where present; absent or blank fields become
// null. The full submission is stored separately in raw_payload, so this
// mapping never loses anything, it only surfaces the common fields as
// columns.
export function mapSubmission(record: Record<string, unknown>): Mapped {
  const str = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value : null;
  const mapped = {} as Mapped;
  for (const field of MAPPED_FIELDS) {
    mapped[field] = str(record[field]);
  }
  return mapped;
}

// Parse a submission body into a flat record of fields, by content type. A
// JSON body (application/json) and a standard HTML form post
// (application/x-www-form-urlencoded, which is what a plain form with no
// JavaScript sends) are both accepted and treated identically afterwards.
// Multipart and file uploads are out of scope. Returns null when the body
// cannot be read as an object, which the endpoint answers with 400.
export function parseSubmissionBody(
  contentType: string | null,
  body: string
): Record<string, unknown> | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();

  if (type === "application/x-www-form-urlencoded") {
    return Object.fromEntries(new URLSearchParams(body));
  }

  if (type === "" || type === "application/json") {
    if (body.trim().length === 0) return {};
    try {
      const parsed: unknown = JSON.parse(body);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }

  return null;
}

// A copy-paste plain HTML form that posts to a form's submission URL with no
// JavaScript: the browser sends application/x-www-form-urlencoded, which the
// endpoint now accepts. The input names are exactly MAPPED_FIELDS plus the
// honeypot, which sits off-screen and is hidden from assistive technology, so
// a real visitor never sees or fills it but a bot that fills every field
// does.
export function buildExampleFormHtml(actionUrl: string): string {
  const fieldLine = (name: string) => {
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    if (name === "message") {
      return `  <label>${label}<br><textarea name="${name}"></textarea></label>`;
    }
    const type = name === "email" ? ' type="email"' : "";
    return `  <label>${label}<br><input name="${name}"${type}></label>`;
  };
  return [
    `<form method="post" action="${actionUrl}">`,
    ...MAPPED_FIELDS.map(fieldLine),
    `  <!-- Honeypot: leave empty. Hidden from real visitors. -->`,
    `  <input name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off"`,
    `         aria-hidden="true" style="position:absolute;left:-5000px" value="">`,
    `  <button type="submit">Send</button>`,
    `</form>`,
  ].join("\n");
}

// True when the honeypot field carries a value, which only a bot would do.
export function isHoneypotTripped(record: Record<string, unknown>): boolean {
  const value = record[HONEYPOT_FIELD];
  return typeof value === "string" && value.trim().length > 0;
}

// The source IP, as seen behind a proxy (Vercel sets x-forwarded-for to the
// real client, client first). Falls back to x-real-ip, then a constant so the
// per-IP limiter still has a key. The first entry is the client per the
// Vercel convention.
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
