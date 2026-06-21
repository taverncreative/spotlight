import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// The operator home: a minimal client picker. Lists the operator's clients
// (RLS-scoped), each opening that client's console. Navigation only; the
// add/edit/manage flows arrive in a later slice.
export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("name, slug")
    .order("name");
  const clients = data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-medium">Clients</h1>
        <p className="text-sm text-muted-foreground">
          Select a client to open its console.
        </p>
      </div>
      {clients.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No clients yet. Client management arrives in a later slice.
        </p>
      ) : (
        <ul className="grid gap-2">
          {clients.map((client) => (
            <li key={client.slug}>
              <Link
                href={`/c/${client.slug}/overview`}
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent"
              >
                <span className="font-medium">{client.name}</span>
                <span className="text-muted-foreground">Open</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
