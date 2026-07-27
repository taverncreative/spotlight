import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/server";
import { getTheme } from "@/lib/theme";
import { signOut } from "@/lib/auth/actions";

// The settings index. This is where the things that used to sit in the home
// header now live: Integrations, appearance, the signed-in address and Sign
// out. They were never per-page concerns, and as header furniture they cost
// eleven controls of attention on every screen to serve about four uses a
// month.
//
// The auth gate is in the settings layout; this page reads the user only to
// show which account is signed in.
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const theme = await getTheme();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-medium">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connections, appearance and your account.
        </p>
      </div>

      <section className="divide-y rounded-card border bg-card">
        <Link
          href="/settings/integrations"
          className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-accent"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Integrations</p>
            <p className="text-xs text-muted-foreground">
              Google, Meta and the per-client content API keys.
            </p>
          </div>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </Link>

        {/* Email health is operator-scoped, not per-client: DMARC domains
            belong to the operator and dmarc_domains.client_id is null on every
            row today. It did not move into the client bar for that reason, and
            it needs an entry point now the header no longer carries one. */}
        <Link
          href="/email"
          className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-accent"
        >
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Email health</p>
            <p className="text-xs text-muted-foreground">
              DMARC domains, ingest addresses and sender reports.
            </p>
          </div>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </Link>

        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Appearance</p>
            <p className="text-xs text-muted-foreground">
              Light or dark. Saved for this browser.
            </p>
          </div>
          <ThemeToggle initialTheme={theme} />
        </div>

        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Signed in</p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.email ?? "Not signed in"}
            </p>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
