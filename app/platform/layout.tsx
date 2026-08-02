import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/server";

// Operator-level platform shell: auth gate, then the standard top bar, the same
// shape as the requests shell. No client selector and no module bar, because a
// BSK View workspace is not a Spotlight client and this view is not scoped to
// one.
//
// The auth gate is load-bearing beyond the usual: everything below reads across
// every BSK View tenant, so an unauthenticated render must never reach the
// fetch.
export default async function PlatformLayout({
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
      <AppHeader />
      <main className="flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
