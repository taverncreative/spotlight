import { AppHeader } from "@/components/app-header";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Operator-level "what's due" shell: auth gate, then the standard top bar,
// mirroring the requests and email shells. Not client-scoped: this view spans
// every client's tasks, so it carries no client selector and no module bar.
export default async function DueLayout({
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
