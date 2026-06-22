import "server-only";
import tls from "node:tls";
import { getDomain } from "tldts";

// The monitoring engine. Runs three independent checks for a site and returns a
// single result; the caller persists it as a site_checks row. Resilient by
// design: a failure in any one check nulls that field and never aborts the
// others. No database access here.

export type CheckResult = {
  status: "up" | "down";
  http_status: number | null;
  response_ms: number | null;
  ssl_expiry: string | null;
  domain_expiry: string | null;
};

const HTTP_TIMEOUT_MS = 10_000;
const SSL_TIMEOUT_MS = 10_000;
const RDAP_TIMEOUT_MS = 10_000;

// HTTP reachability + response time. Up on 2xx/3xx; down on 4xx/5xx, timeout,
// DNS failure or refused connection.
async function checkHttp(url: string): Promise<{
  status: "up" | "down";
  http_status: number | null;
  response_ms: number | null;
}> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: {
        "user-agent": "SpotlightMonitor/1.0 (+https://businesssortedkent.co.uk)",
      },
    });
    const responseMs = Math.round(performance.now() - start);
    const up = res.status >= 200 && res.status < 400;
    return {
      status: up ? "up" : "down",
      http_status: res.status,
      response_ms: responseMs,
    };
  } catch {
    return { status: "down", http_status: null, response_ms: null };
  }
}

// SSL certificate expiry for HTTPS. rejectUnauthorized is off so an expired or
// self-signed cert can still be read for its validity rather than erroring out.
function checkSsl(hostname: string, port: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        if (cert && cert.valid_to) {
          const expiry = new Date(cert.valid_to);
          finish(Number.isNaN(expiry.getTime()) ? null : expiry.toISOString());
        } else {
          finish(null);
        }
      }
    );
    socket.setTimeout(SSL_TIMEOUT_MS, () => finish(null));
    socket.on("error", () => finish(null));
  });
}

// Domain expiry via RDAP: IANA bootstrap to find the TLD's RDAP server, then the
// domain record's expiration event. The bootstrap is fetched once and cached.
type Bootstrap = { services?: [string[], string[]][] };
type RdapDomain = { events?: { eventAction?: string; eventDate?: string }[] };

let bootstrapCache: Promise<Bootstrap | null> | null = null;
function loadBootstrap(): Promise<Bootstrap | null> {
  if (!bootstrapCache) {
    bootstrapCache = fetch("https://data.iana.org/rdap/dns.json", {
      signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
    })
      .then((res) => (res.ok ? (res.json() as Promise<Bootstrap>) : null))
      .catch(() => null);
  }
  return bootstrapCache;
}

async function rdapBaseForTld(tld: string): Promise<string | null> {
  const data = await loadBootstrap();
  if (!data?.services) return null;
  for (const [tlds, urls] of data.services) {
    if (tlds.includes(tld) && urls.length) {
      let base = urls.find((url) => url.startsWith("https://")) ?? urls[0];
      if (!base.endsWith("/")) base += "/";
      return base;
    }
  }
  return null;
}

async function checkDomainExpiry(hostname: string): Promise<string | null> {
  // Registrable domain (eTLD+1) handles subdomains and multi-level suffixes.
  const registrable = getDomain(hostname);
  if (!registrable) return null;
  const tld = registrable.split(".").pop();
  if (!tld) return null;

  const base = await rdapBaseForTld(tld);
  if (!base) return null;

  try {
    const res = await fetch(`${base}domain/${registrable}`, {
      headers: { accept: "application/rdap+json" },
      signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RdapDomain;
    const expiration = data.events?.find(
      (event) => event.eventAction === "expiration"
    );
    if (!expiration?.eventDate) return null;
    const expiry = new Date(expiration.eventDate);
    return Number.isNaN(expiry.getTime()) ? null : expiry.toISOString();
  } catch {
    return null;
  }
}

export async function checkSite(rawUrl: string): Promise<CheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      status: "down",
      http_status: null,
      response_ms: null,
      ssl_expiry: null,
      domain_expiry: null,
    };
  }

  const isHttps = parsed.protocol === "https:";
  const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;

  const [http, ssl, domain] = await Promise.all([
    checkHttp(parsed.toString()),
    isHttps
      ? checkSsl(parsed.hostname, port).catch(() => null)
      : Promise.resolve(null),
    checkDomainExpiry(parsed.hostname).catch(() => null),
  ]);

  return {
    status: http.status,
    http_status: http.http_status,
    response_ms: http.response_ms,
    ssl_expiry: ssl,
    domain_expiry: domain,
  };
}
