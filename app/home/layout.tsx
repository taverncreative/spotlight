import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { ClientSelector } from "@/components/client-selector";
import { createClient } from "@/lib/supabase/server";

// The operator home shell: auth gate, then a deliberately thin top bar.
//
// It used to carry eleven controls. Requests, Print, Due and Email are moving
// into the client they belong to, and Integrations, the theme toggle, the
// signed-in address and Sign out are now content on /settings rather than
// furniture on every page. What is left is the wordmark, the client selector
// and Time, which is genuinely cross-client.
//
// The two header count queries went with the badges they fed, so this layout
// now makes one query instead of three.
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

  const { data: clientList } = await supabase
    .from("clients")
    .select("name, slug")
    .neq("status", "archived")
    .order("name");
  const clients = clientList ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between gap-3 border-b px-6">
        <div className="flex items-center gap-3">
          <Wordmark textClassName="text-sm" />
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <ClientSelector clients={clients} />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" render={<Link href="/due" />}>
            Due
          </Button>
          <Button variant="ghost" size="sm" render={<Link href="/time" />}>
            Time
          </Button>
          {/* NOT in the brief, and here on purpose: everything stripped above
              moved to /settings, and with no link anywhere the operator could
              not reach Integrations or sign out at all. One entry point in
              place of the five removed. Delete this line if you would rather
              reach settings another way. */}
          <Button variant="ghost" size="sm" render={<Link href="/settings" />}>
            Settings
          </Button>
        </div>
      </header>
      <main className="flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
