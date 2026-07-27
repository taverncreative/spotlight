import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/wordmark";
import { createClient } from "@/lib/supabase/server";

// Operator-level settings shell: auth gate, then a thin top bar. The theme
// toggle, the signed-in address and Sign out used to sit in this header; they
// are now content on the settings index, which is the page they belong to. The
// brand links back to the client grid.
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center gap-3 border-b px-6">
        <Link href="/home" className="transition-opacity hover:opacity-80">
          <Wordmark textClassName="text-sm" />
        </Link>
      </header>
      <main className="flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
