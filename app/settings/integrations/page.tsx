import Link from "next/link";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { GSC_PROVIDER } from "@/lib/oauth/google";
import { disconnectGoogleSearchConsole } from "./actions";

const COMING_SOON = [
  { name: "Google Analytics 4", detail: "Traffic and engagement." },
  { name: "Google Business Profile", detail: "Reviews and local presence." },
  { name: "Meta", detail: "Facebook and Instagram." },
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
        "rounded-lg border px-4 py-3 text-sm",
        tone === "ok"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      )}
    >
      {children}
    </p>
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

  const { data: gsc } = await supabase
    .from("oauth_connections")
    .select("account_email")
    .eq("provider", GSC_PROVIDER)
    .maybeSingle();

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
        <li className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Google Search Console</p>
              {gsc ? (
                <p className="truncate text-xs text-muted-foreground">
                  Connected as {gsc.account_email ?? "your Google account"}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Search performance and indexing.
                </p>
              )}
            </div>
            {gsc ? (
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="secondary">Connected</Badge>
                <form action={disconnectGoogleSearchConsole}>
                  <Button type="submit" variant="outline" size="sm">
                    Disconnect
                  </Button>
                </form>
              </div>
            ) : (
              <Button size="sm" render={<Link href="/api/oauth/google/start" />}>
                Connect
              </Button>
            )}
          </div>
        </li>

        {COMING_SOON.map((product) => (
          <li
            key={product.name}
            className="rounded-lg border bg-card p-4 opacity-60"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{product.name}</p>
                <p className="text-xs text-muted-foreground">{product.detail}</p>
              </div>
              <Badge variant="outline">Coming soon</Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
