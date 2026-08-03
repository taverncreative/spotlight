import { AppHeader } from "@/components/app-header";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Operator-level requests shell: auth gate, then the standard top bar, mirroring
// the settings shell. No client selector and no module bar: an inbound request
// may carry no client at all, so this view is not scoped to one.
export default async function RequestsLayout({
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
