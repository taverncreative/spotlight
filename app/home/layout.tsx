import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
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

  const theme = await getTheme();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between gap-3 border-b px-6">
        <Wordmark textClassName="text-sm" />
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
