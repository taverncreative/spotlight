"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteSocialPost } from "@/lib/social/actions";

// Per-card delete with a confirm dialog (the Slice 6 site-remove pattern).
// Calls the action directly inside a transition (no form/effect), so success
// can close the dialog and refresh without setState-in-effect; failures show
// inline instead of silently leaving the dialog open.
export function SocialDeleteButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("id", postId);
        const result = await deleteSocialPost(null, formData);
        if (result?.ok) {
          setOpen(false);
          router.refresh();
        } else {
          setError(result?.error ?? "Could not delete the post.");
        }
      } catch {
        setError("Could not delete the post.");
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Delete
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <div className="space-y-2">
            <AlertDialogTitle>Delete post?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the post and its photos. This cannot be
              undone.
            </AlertDialogDescription>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={pending}
            >
              {pending ? "Deleting" : "Delete"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
