import { createClient } from "@/lib/supabase/server";
import { ClientGrid } from "@/components/client-grid";
import type { ClientRow } from "@/components/client-form-dialog";

// The operator home: a card per client, and nothing else yet.
//
// This replaced the cross-client monitoring board, which ran six queries to
// build a summary strip, an attention zone, a newest-requests panel and an
// all-projects comparison table. Only the clients query survives. The site
// risk engine (lib/sites/monitoring.ts) is untouched and still drives the
// per-client Sites tab, which is now the only place that reading lives.
//
// deploy_hook_url is selected but never passed on: it is narrowed to a boolean
// below, before the row reaches a client component.
type ClientCipherRow = Omit<ClientRow, "has_deploy_hook"> & {
  deploy_hook_url: string | null;
};

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name, slug, status, blog_base_url, deploy_hook_url")
    .order("name");

  // Drop the deploy hook ciphertext here. ClientGrid is a client component, so
  // the column is replaced by presence-only before it can travel.
  const clients: ClientRow[] = ((data ?? []) as ClientCipherRow[]).map(
    ({ deploy_hook_url, ...client }) => ({
      ...client,
      has_deploy_hook: deploy_hook_url !== null,
    })
  );

  return <ClientGrid clients={clients} />;
}
