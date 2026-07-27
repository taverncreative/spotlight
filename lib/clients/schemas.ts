import { z } from "zod";

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

export const clientFormSchema = z.object({
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
  // The public root of the client's blog. Optional: blank means we do not know
  // where their posts live, and the share caption omits the link. The trailing
  // slash is stripped before validating so the post link stays a plain
  // `${blog_base_url}/${slug}` join.
  blog_base_url: z
    .string()
    .trim()
    .transform((value) => value.replace(/\/+$/, ""))
    .refine(
      (value) => value === "" || isHttpUrl(value),
      "Use a full URL, e.g. https://businesssortedkent.co.uk/news"
    ),
  // The client's build trigger, for static sites only. Optional: blank means no
  // hook is being submitted, which on edit means "leave the saved one alone"
  // rather than "clear it" (the stored value is encrypted, so it is never
  // rendered back into the form for editing; deploy_hook_remove below is the
  // only way to clear it).
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
  // Edit-only: tick to clear the stored hook.
  deploy_hook_remove: z.boolean(),
});

export type ClientFormValues = z.infer<typeof clientFormSchema>;

// Form-action result consumed by useActionState in the client form. ok=true on
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
