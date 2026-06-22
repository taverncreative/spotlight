import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { ClientSelector } from "@/components/client-selector";
import { ModuleBar } from "@/components/module-bar";
import { createClient } from "@/lib/supabase/server";
import { getTheme } from "@/lib/theme";
import { requireClient } from "@/lib/clients/require-client";
import { signOut } from "@/lib/auth/actions";

// The per-client app shell: auth gate, resolve the client by slug (RLS scopes to
// operator_id = auth.uid(), so a foreign or unknown slug returns no row and 404s),
// then the branded top bar (with client selector) and the bottom module bar
// around the active module page.
export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { user } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data: clientList } = await supabase
    .from("clients")
    .select("name, slug")
    .order("name");
  const clients = clientList ?? [];

  const theme = await getTheme();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between gap-3 border-b px-6">
        <div className="flex items-center gap-3">
          <Wordmark textClassName="text-sm" />
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <ClientSelector clients={clients} />
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            render={<Link href="/settings/integrations" />}
          >
            Integrations
          </Button>
          <ThemeToggle initialTheme={theme} />
          <span className="truncate text-sm text-muted-foreground">
            {user.email}
          </span>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-6 lg:p-8">{children}</main>
      <ModuleBar clientSlug={clientSlug} />
    </div>
  );
}
