"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteSite } from "@/lib/sites/actions";
import type { SiteFormState } from "@/lib/sites/schemas";
import type { SiteView } from "@/lib/sites/monitoring";

// Confirm-and-remove a site. Hard delete; site_checks cascade in the schema.
export function SiteRemoveDialog({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: SiteView | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SiteFormState, FormData>(
    deleteSite,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }, [state, onOpenChange, router]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <div className="space-y-2">
          <AlertDialogTitle>Remove site?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes {site?.hostname ?? "this site"} and its
            check history. This cannot be undone.
          </AlertDialogDescription>
        </div>
        <form action={formAction} className="flex justify-end gap-2">
          <input type="hidden" name="id" value={site?.id ?? ""} />
          <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
          <AlertDialogAction type="submit" variant="destructive" disabled={pending}>
            {pending ? "Removing" : "Remove"}
          </AlertDialogAction>
        </form>
        {state?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
