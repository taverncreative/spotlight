"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { checkAll } from "@/lib/sites/actions";
import type { SiteFormState } from "@/lib/sites/schemas";

// Header "Check all": runs the checker for every site under the client, then
// refreshes the list.
export function CheckAllButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SiteFormState, FormData>(
    checkAll,
    null
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="client_id" value={clientId} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Checking…" : "Check all"}
      </Button>
    </form>
  );
}
