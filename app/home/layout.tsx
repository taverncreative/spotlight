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

  // The client list (for the selector) and the counts of untriaged requests and
  // unprinted orders (for the header badges), in one round trip. Each count is
  // head:true, so it fetches no rows, and each is RLS-scoped and hits its status
  // index, so they ride along essentially free.
  const [
    { data: clientList },
    { count: newRequestCount },
    { count: newPrintOrderCount },
  ] = await Promise.all([
    supabase.from("clients").select("name, slug").order("name"),
    supabase
      .from("client_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "new"),
    supabase
      .from("print_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "new"),
  ]);
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
          <Button variant="ghost" size="sm" render={<Link href="/requests" />}>
            Requests
            {newRequestCount ? (
              <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-pill bg-brand px-1.5 text-xs font-medium text-brand-foreground">
                {newRequestCount}
              </span>
            ) : null}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            render={<Link href="/print-orders" />}
          >
            Print
            {newPrintOrderCount ? (
              <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-pill bg-brand px-1.5 text-xs font-medium text-brand-foreground">
                {newPrintOrderCount}
              </span>
            ) : null}
          </Button>
          <Button variant="ghost" size="sm" render={<Link href="/due" />}>
            Due
          </Button>
          <Button variant="ghost" size="sm" render={<Link href="/time" />}>
            Time
          </Button>
          <Button variant="ghost" size="sm" render={<Link href="/email" />}>
            Email
          </Button>
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
