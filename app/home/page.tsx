import { createClient } from "@/lib/supabase/server";
import { ClientRoster } from "@/components/client-roster";

// The operator home: the client roster. Lists the operator's clients
// (RLS-scoped); add, edit and open are handled in the roster. Hard delete is not
// offered; Archived status is the soft path.
export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name, slug, status")
    .order("name");

  return <ClientRoster clients={data ?? []} />;
}
