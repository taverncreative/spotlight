import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import {
  GOOGLE_PROVIDER_KEYS,
  type GoogleProvider,
} from "@/lib/oauth/providers";
import { META_PROVIDER } from "@/lib/oauth/meta";
import { MetaAccountAssign } from "@/components/integrations/meta-account-assign";
import { disconnectGoogleProvider, disconnectMeta } from "./actions";

type ClientOption = { id: string; name: string };

const COMING_SOON = [
  { name: "Google Business Profile", detail: "Reviews and local presence." },
];

function Banner({
  tone,
  children,
}: {
  tone: "ok" | "danger";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-card border px-4 py-3 text-sm",
        tone === "ok"
          ? "border-status-ok/30 bg-status-ok/10 text-status-ok"
          : "border-status-danger/30 bg-status-danger/10 text-status-danger"
      )}
    >
      {children}
    </p>
  );
}

type CardConnection = { account_email: string | null } | null;

// One Google product card. Reflects its own connection state independently:
// Connect (links to the start route with this provider) or Connected + Disconnect.
function IntegrationCard({
  provider,
  name,
  description,
  connection,
}: {
  provider: GoogleProvider;
  name: string;
  description: string;
  connection: CardConnection;
}) {
  return (
    <li className="rounded-card border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{name}</p>
          {connection ? (
            <p className="truncate text-xs text-muted-foreground">
              Connected as {connection.account_email ?? "your Google account"}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {connection ? (
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary">Connected</Badge>
            <form action={disconnectGoogleProvider}>
              <input type="hidden" name="provider" value={provider} />
              <Button type="submit" variant="outline" size="sm">
                Disconnect
              </Button>
            </form>
          </div>
        ) : (
          <Button
            size="sm"
            render={
              <Link href={`/api/oauth/google/start?provider=${provider}`} />
            }
          >
            Connect
          </Button>
        )}
      </div>
    </li>
  );
}

type MetaAccountRow = {
  id: string;
  platform: string;
  display_name: string | null;
  external_id: string;
  parent_account_id: string | null;
  client_id: string | null;
  needs_reconnect: boolean;
};

// The Meta card differs from the single-account Google cards: one connection
// fans out to many Pages, each optionally with a linked Instagram account, so it
// summarises them all. Connect links to the Meta start route; Disconnect tears
// the whole grant down (the facebook connection + every connected account).
function MetaIntegrationCard({
  connected,
  accounts,
  clients,
}: {
  connected: boolean;
  accounts: MetaAccountRow[];
  clients: ClientOption[];
}) {
  const pages = accounts.filter((a) => a.platform === "facebook");
  const instagrams = accounts.filter((a) => a.platform === "instagram");

  return (
    <li className="rounded-card border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Meta</p>
          {connected ? (
            <p className="text-xs text-muted-foreground">
              {pages.length} Page{pages.length === 1 ? "" : "s"}
              {instagrams.length > 0
                ? ` · ${instagrams.length} Instagram account${
                    instagrams.length === 1 ? "" : "s"
                  }`
                : ""}{" "}
              connected
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Facebook Pages and Instagram.
            </p>
          )}
        </div>
        {connected ? (
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary">Connected</Badge>
            <form action={disconnectMeta}>
              <Button type="submit" variant="outline" size="sm">
                Disconnect
              </Button>
            </form>
          </div>
        ) : (
          <Button size="sm" render={<Link href="/api/oauth/meta/start" />}>
            Connect
          </Button>
        )}
      </div>

      {connected && pages.length > 0 ? (
        <ul className="mt-3 space-y-3 border-t pt-3">
          {pages.map((page) => {
            const linked = instagrams.filter(
              (ig) => ig.parent_account_id === page.id
            );
            return (
              <li key={page.id} className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">
                      Facebook
                    </span>
                    <span className="truncate">
                      {page.display_name ?? page.external_id}
                    </span>
                    {page.needs_reconnect ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-status-warn/40 text-status-warn"
                      >
                        Reconnect needed
                      </Badge>
                    ) : null}
                  </div>
                  <MetaAccountAssign
                    key={`${page.id}:${page.client_id ?? ""}`}
                    accountId={page.id}
                    currentClientId={page.client_id}
                    clients={clients}
                  />
                </div>
                {linked.map((ig) => (
                  <div
                    key={ig.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-20 shrink-0 text-xs text-muted-foreground">
                        Instagram
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {ig.display_name ?? ig.external_id}
                      </span>
                      {ig.needs_reconnect ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-status-warn/40 text-status-warn"
                        >
                          Reconnect needed
                        </Badge>
                      ) : null}
                    </div>
                    <MetaAccountAssign
                      key={`${ig.id}:${ig.client_id ?? ""}`}
                      accountId={ig.id}
                      currentClientId={ig.client_id}
                      clients={clients}
                    />
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("oauth_connections")
    .select("provider, account_email")
    .in("provider", GOOGLE_PROVIDER_KEYS);
  const byProvider = new Map(
    (rows ?? []).map((row) => [row.provider as string, row])
  );
  const conn = (provider: GoogleProvider): CardConnection =>
    byProvider.get(provider) ?? null;

  // Meta connection state + the operator's connected Pages/IG accounts
  // (meta_accounts RLS scopes these to this operator).
  const { data: metaConn } = await supabase
    .from("oauth_connections")
    .select("provider")
    .eq("provider", META_PROVIDER)
    .maybeSingle();
  const { data: metaAccounts } = await supabase
    .from("meta_accounts")
    .select(
      "id, platform, display_name, external_id, parent_account_id, client_id, needs_reconnect"
    )
    .order("created_at", { ascending: true });

  // The operator's clients populate each account's assignment selector (RLS
  // scopes this to the operator's own clients).
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .order("name", { ascending: true });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-medium">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect the Google and Meta products Spotlight reads from.
        </p>
      </div>

      {connected ? <Banner tone="ok">Connected.</Banner> : null}
      {error ? (
        <Banner tone="danger">
          Could not connect ({error}). Please try again.
        </Banner>
      ) : null}

      <ul className="grid gap-2">
        <IntegrationCard
          provider="google_search_console"
          name="Google Search Console"
          description="Search performance and indexing."
          connection={conn("google_search_console")}
        />
        <IntegrationCard
          provider="google_analytics"
          name="Google Analytics 4"
          description="Traffic and engagement."
          connection={conn("google_analytics")}
        />

        <MetaIntegrationCard
          connected={!!metaConn}
          accounts={(metaAccounts ?? []) as MetaAccountRow[]}
          clients={(clients ?? []) as ClientOption[]}
        />

        {COMING_SOON.map((product) => (
          <li
            key={product.name}
            className="rounded-card border bg-card p-4 opacity-60"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{product.name}</p>
                <p className="text-xs text-muted-foreground">
                  {product.detail}
                </p>
              </div>
              <Badge variant="outline">Coming soon</Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
