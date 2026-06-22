"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { checkNow } from "@/lib/sites/actions";
import type { SiteFormState } from "@/lib/sites/schemas";

// Per-site "Check now": runs the checker for one site and refreshes the list.
export function CheckNowButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SiteFormState, FormData>(
    checkNow,
    null
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={siteId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Checking…" : "Check now"}
      </Button>
    </form>
  );
}
