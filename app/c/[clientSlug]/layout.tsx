import { AppHeader } from "@/components/app-header";
import { ClientSelector } from "@/components/client-selector";
import { ModuleBar } from "@/components/module-bar";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";

// The per-client app shell: auth gate, resolve the client by slug (RLS scopes to
// operator_id = auth.uid(), so a foreign, unknown or archived slug returns no row
// and 404s), then the shared app header with a client selector beside the mark,
// and the module bar around the active module page.
//
// The header is now the same component every other shell uses. It used to carry
// an All projects button, an Integrations link, a theme toggle, the operator's
// email and a sign-out button, none of which appeared on /home, so moving into a
// client rearranged the furniture around you. Integrations is operator-level and
// lives on /settings; theme, email and sign-out are content there too.
export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  await requireClient(clientSlug);

  const supabase = await createClient();
  const { data: clientList } = await supabase
    .from("clients")
    .select("name, slug")
    .neq("status", "archived")
    .order("name");

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader>
        <ClientSelector clients={clientList ?? []} />
      </AppHeader>
      <main className="flex-1 p-6 lg:p-8">{children}</main>
      <ModuleBar clientSlug={clientSlug} />
    </div>
  );
}
