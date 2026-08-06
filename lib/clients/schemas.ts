import { z } from "zod";
import { SERVICES } from "@/lib/clients/health";
import { MAX_THEME_LENGTH, THEME_SLOTS } from "@/lib/calendar/weekday-themes";

// The client status set, shared by the Zod schema, the management UI and the DB
// check constraint. KEEP IN SYNC with migration 0008_clients_status_paused.sql.
export const CLIENT_STATUSES = ["active", "paused", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

// Derive a URL-safe slug from a name: lowercase, non-alphanumerics to hyphens,
// collapse runs, trim leading/trailing hyphens.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// A full http(s) URL. Parsed rather than pattern-matched so odd-but-valid hosts
// pass and non-web schemes (mailto:, ftp:) do not.
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Hosts a deploy hook may never point at. Spotlight fetches the stored URL
// server-side, so a loopback or private-range host would turn this field into a
// lever for reaching whatever else runs on that network. Only the operator can
// set it, so this is a guard rail rather than a defence against an attacker, but
// it costs one function.
function isPrivateHost(hostname: string): boolean {
  // URL.hostname wraps IPv6 literals in brackets; strip them before matching.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true; // mDNS
  if (host === "::1" || host === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // IPv6 unique-local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // IPv6 link-local fe80::/10

  // IPv4 literals: 0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    const first = Number(v4[1]);
    const second = Number(v4[2]);
    if (first === 0 || first === 10 || first === 127) return true;
    if (first === 169 && second === 254) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
  }

  return false;
}

// A deploy hook URL. https only: the secret is the URL itself, so http would put
// the credential on the wire in clear.
function isDeployHookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}

// SPLIT IN TWO, deliberately.
//
// The dialog had grown to eight fields, most of which were not what you need to
// bring a client into existence. Name, slug and status are: without them there
// is no row and no URL. Everything else is configuration that wants room to
// explain itself, and now lives on the client's own Settings tab.
//
// Keeping them as separate schemas rather than one with optional halves means
// neither form can quietly submit the other's fields.

// What the Add/Edit dialog writes. The minimum to create a client at all.
export const clientRosterSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers and single hyphens."
    ),
  status: z.enum(CLIENT_STATUSES),
});

// What the client's Settings tab writes. Everything that configures how we work
// for them rather than who they are.
export const clientSettingsSchema = z.object({
  // The public root of the client's blog. Optional: blank means we do not know
  // where their posts live. The trailing slash is stripped before validating so
  // the post link stays a plain `${blog_base_url}/${slug}` join.
  blog_base_url: z
    .string()
    .trim()
    .transform((value) => value.replace(/\/+$/, ""))
    .refine(
      (value) => value === "" || isHttpUrl(value),
      "Use a full URL, e.g. https://businesssortedkent.co.uk/news"
    ),
  // The client's build trigger, for static sites only. Blank means "leave the
  // saved one alone" rather than "clear it": the stored value is encrypted and
  // never rendered back, so deploy_hook_remove is the only way to clear it.
  //
  // Unlike blog_base_url the trailing slash is NOT stripped. That field is a
  // path we join a slug onto; this one is an opaque endpoint whose exact path is
  // the secret, so it is stored byte-for-byte as the platform issued it.
  deploy_hook_url: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || isDeployHookUrl(value),
      "Use the full https URL from your hosting platform. Not http, and not a local or private address."
    ),
  deploy_hook_remove: z.boolean(),
  // Which services this client is actually on. Not derived: a connected Meta
  // account is a capability, not a commitment, and the neglect score has to know
  // the difference (see migration 0061).
  services: z.array(z.enum(SERVICES)),
});

// The seven weekday themes, written from the social calendar rather than the
// Settings tab. Its own schema for the same reason the two above are separate:
// it is posted by its own form, and neither form should be able to submit the
// other's fields.
//
// Exactly seven, Monday first, '' for a day with no theme -- the shape the
// column's check constraint enforces (0091). The length cap is here because a
// check constraint cannot express "every element is at most 24 characters"
// without a subquery.
export const weekdayThemesSchema = z.object({
  weekday_themes: z
    .array(
      z
        .string()
        .trim()
        .max(
          MAX_THEME_LENGTH,
          `Keep a theme under ${MAX_THEME_LENGTH} characters.`
        )
    )
    .length(THEME_SLOTS),
});

export type ClientRosterValues = z.infer<typeof clientRosterSchema>;
export type ClientSettingsValues = z.infer<typeof clientSettingsSchema>;

// Form-action result consumed by useActionState in both client forms. ok=true on
// a successful save; otherwise a top-level error and/or per-field errors.
export type ClientFormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// Build a field -> messages map from a Zod error. Reads error.issues directly
// (stable across Zod versions) rather than the changing flatten helpers.
export function fieldErrorsFromZod(
  error: z.ZodError
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : "";
    if (!key) continue;
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
