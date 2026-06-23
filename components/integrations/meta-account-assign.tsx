"use client";

import { cn } from "@/lib/utils";
import { fieldInputClass } from "@/components/form-field";
import { assignMetaAccountClient } from "@/app/settings/integrations/actions";

type ClientOption = { id: string; name: string };

// Per-account client assignment selector on the Integrations Meta card. Changing
// it submits the operator-scoped assignMetaAccountClient action, which writes
// meta_accounts.client_id — the exact column the Social composer's "Post to"
// selector filters on. Uncontrolled (defaultValue): the parent remounts this via
// a key that includes the current client_id, so a revalidated assignment (e.g. an
// Instagram row cascaded from its Page) is reflected without a full reload.
export function MetaAccountAssign({
  accountId,
  currentClientId,
  clients,
}: {
  accountId: string;
  currentClientId: string | null;
  clients: ClientOption[];
}) {
  return (
    <form action={assignMetaAccountClient} className="shrink-0">
      <input type="hidden" name="account_id" value={accountId} />
      <select
        name="client_id"
        defaultValue={currentClientId ?? ""}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        aria-label="Assign to client"
        className={cn(fieldInputClass, "h-8 w-44 py-1 text-xs")}
      >
        <option value="">Unassigned</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </form>
  );
}
