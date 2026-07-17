"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { fieldInputClass } from "@/components/form-field";
import { createClientAction, updateClientAction } from "@/app/home/actions";
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
  slugify,
  type ClientFormState,
} from "@/lib/clients/schemas";

export type ClientRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  blog_base_url: string | null;
};

// The add/edit client modal. client === null is the add case; otherwise it is
// pre-filled for editing. The slug auto-derives from the name until the operator
// edits it by hand. Mount it under a changing `key` so each open starts fresh.
export function ClientFormDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientRow | null;
}) {
  const router = useRouter();
  const isEdit = client !== null;
  const action = isEdit ? updateClientAction : createClientAction;
  const [state, formAction, pending] = useActionState<
    ClientFormState,
    FormData
  >(action, null);

  const [name, setName] = useState(client?.name ?? "");
  const [slug, setSlug] = useState(client?.slug ?? "");
  const [status, setStatus] = useState(client?.status ?? "active");
  const [blogBaseUrl, setBlogBaseUrl] = useState(client?.blog_base_url ?? "");
  // In edit mode the slug is treated as operator-set so it does not auto-rewrite.
  const [slugEdited, setSlugEdited] = useState(isEdit);

  // Close and refresh the roster on a successful save.
  useEffect(() => {
    if (state?.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }, [state, onOpenChange, router]);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="space-y-1">
          <DialogTitle>{isEdit ? "Edit client" : "Add client"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this client's details."
              : "Add a client to your roster."}
          </DialogDescription>
        </div>
        <form action={formAction} className="space-y-4">
          {client ? <input type="hidden" name="id" value={client.id} /> : null}

          <div className="space-y-1.5">
            <label htmlFor="client-name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="client-name"
              name="name"
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              autoFocus
              required
              className={fieldInputClass}
            />
            {state?.fieldErrors?.name ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.name[0]}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="client-slug" className="text-sm font-medium">
              Slug
            </label>
            <input
              id="client-slug"
              name="slug"
              value={slug}
              onChange={(event) => {
                setSlug(event.target.value);
                setSlugEdited(true);
              }}
              required
              className={`${fieldInputClass} font-mono`}
            />
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">/c/{slug || "your-slug"}</span>
              {isEdit ? " — changing this changes the client's URL." : null}
            </p>
            {state?.fieldErrors?.slug ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.slug[0]}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="client-status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="client-status"
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className={fieldInputClass}
            >
              {CLIENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {CLIENT_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="client-blog-base-url" className="text-sm font-medium">
              Blog base URL{" "}
              <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="client-blog-base-url"
              name="blog_base_url"
              type="url"
              inputMode="url"
              value={blogBaseUrl}
              onChange={(event) => setBlogBaseUrl(event.target.value)}
              placeholder="https://businesssortedkent.co.uk/news"
              className={fieldInputClass}
            />
            <p className="text-xs text-muted-foreground">
              Where this client&rsquo;s posts live publicly. Sharing a post to
              social appends{" "}
              <span className="font-mono">
                {blogBaseUrl.replace(/\/+$/, "") || "…"}/post-slug
              </span>{" "}
              to the caption. Leave blank to omit the link.
            </p>
            {state?.fieldErrors?.blog_base_url ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.blog_base_url[0]}
              </p>
            ) : null}
          </div>

          {state?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
