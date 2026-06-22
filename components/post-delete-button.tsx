"use client";

import { useActionState, useEffect, useState } from "react";
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
import { deletePost } from "@/lib/posts/actions";
import type { PostFormState } from "@/lib/posts/schemas";

// Per-row delete with a confirm dialog (the Slice 6 site-remove pattern).
export function PostDeleteButton({
  postId,
  title,
}: {
  postId: string;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<PostFormState, FormData>(
    deletePost,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <div className="space-y-2">
            <AlertDialogTitle>Delete post?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “{title}”. This cannot be undone.
            </AlertDialogDescription>
          </div>
          <form action={formAction} className="flex justify-end gap-2">
            <input type="hidden" name="id" value={postId} />
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              variant="destructive"
              disabled={pending}
            >
              {pending ? "Deleting" : "Delete"}
            </AlertDialogAction>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
