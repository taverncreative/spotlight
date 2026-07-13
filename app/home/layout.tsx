import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { ClientSelector } from "@/components/client-selector";
import { AllProjectsButton } from "@/components/all-projects-button";
import { createClient } from "@/lib/supabase/server";
import { getTheme } from "@/lib/theme";
import { signOut } from "@/lib/auth/actions";

// The single-operator app shell: auth gate, then a branded top bar over the
// content region. Signed-out visitors go to /login. No client selector and no
// module navigation yet; those arrive in later slices.
export default async function HomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The same alphabetical, RLS-scoped client list the workspace header uses, so
  // the selector renders standalone here at the top level (no active client).
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
          <AllProjectsButton />
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
    </div>
  );
}
