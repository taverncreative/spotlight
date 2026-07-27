import { AppHeader } from "@/components/app-header";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Operator-level email-health shell: auth gate, then the standard top bar,
// mirroring the requests and settings shells. Not client-scoped: monitored
// domains are the operator's own, not a client's.
export default async function EmailLayout({
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
