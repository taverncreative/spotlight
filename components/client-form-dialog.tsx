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
import { SERVICES, SERVICE_LABELS } from "@/lib/clients/health";
import { uploadClientLogo } from "@/lib/clients/logo-upload";
import { initialsFrom } from "@/components/client-grid";

export type ClientRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  blog_base_url: string | null;
  // Presence only. The deploy hook is stored encrypted and this row reaches the
  // browser, so the value itself is narrowed to a boolean server-side (see
  // app/home/page.tsx) and never travels.
  has_deploy_hook: boolean;
  // Which services this client is on. Drives which signals the neglect score
  // treats as applicable, so an empty list means the score stays silent rather
  // than reading zero.
  services: string[];
  // Public URL of the uploaded logo, or null to fall back to initials.
  logo_url: string | null;
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
  const hasDeployHook = client?.has_deploy_hook ?? false;
  const action = isEdit ? updateClientAction : createClientAction;
  const [state, formAction, pending] = useActionState<
    ClientFormState,
    FormData
  >(action, null);

  const [name, setName] = useState(client?.name ?? "");
  const [slug, setSlug] = useState(client?.slug ?? "");
  const [status, setStatus] = useState(client?.status ?? "active");
  const [blogBaseUrl, setBlogBaseUrl] = useState(client?.blog_base_url ?? "");
  const [services, setServices] = useState<string[]>(client?.services ?? []);
  const [logoUrl, setLogoUrl] = useState(client?.logo_url ?? "");
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [deployHookUrl, setDeployHookUrl] = useState("");
  const [removeDeployHook, setRemoveDeployHook] = useState(false);
  // In edit mode the slug is treated as operator-set so it does not auto-rewrite.
  const [slugEdited, setSlugEdited] = useState(isEdit);

  // Close and refresh the roster on a successful save.
  useEffect(() => {
    if (state?.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }, [state, onOpenChange, router]);

  // The upload runs browser-to-storage and only its RESULT reaches the form, in
  // a hidden field, so the server never handles the bytes. Storage RLS is the
  // write gate (0065), keyed on the client-id folder.
  //
  // Only possible when editing: the object path is {client_id}/<file>, and a
  // client being created has no id yet. The control says so rather than failing.
  async function handleLogoFile(file: File | undefined) {
    if (!file || !client) return;
    setLogoBusy(true);
    setLogoError(null);
    const result = await uploadClientLogo(file, client.id);
    setLogoBusy(false);
    if (result.ok) setLogoUrl(result.url);
    else setLogoError(result.error);
  }

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
            <span className="text-sm font-medium">
              Logo <span className="text-muted-foreground">(optional)</span>
            </span>
            <input type="hidden" name="logo_url" value={logoUrl} />
            <div className="flex items-center gap-3">
              {/* Same 44px box the card uses, showing exactly what the card
                  will show: the logo if there is one, the initials if not. */}
              <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-control bg-brand/10 text-sm font-semibold tracking-wide text-brand">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  initialsFrom(name || "?")
                )}
              </span>
              {isEdit ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="client-logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={logoBusy}
                    onChange={(event) => {
                      void handleLogoFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    className="max-w-[13rem] text-xs file:mr-2 file:rounded-control file:border file:border-input file:bg-secondary file:px-2 file:py-1 file:text-xs"
                  />
                  {logoUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLogoUrl("")}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Save the client first, then add a logo.
                </p>
              )}
            </div>
            {logoBusy ? (
              <p className="text-xs text-muted-foreground">Uploading…</p>
            ) : null}
            {logoError ? (
              <p className="text-sm text-destructive">{logoError}</p>
            ) : null}
            {!logoBusy && !logoError ? (
              <p className="text-xs text-muted-foreground">
                PNG, JPEG or WebP, under 2 MB. Falls back to initials.
              </p>
            ) : null}
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">
              Services{" "}
              <span className="text-muted-foreground">(optional)</span>
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-0.5">
              {SERVICES.map((service) => (
                <label
                  key={service}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="services"
                    value={service}
                    checked={services.includes(service)}
                    onChange={(event) =>
                      setServices((current) =>
                        event.target.checked
                          ? [...current, service]
                          : current.filter((s) => s !== service)
                      )
                    }
                    className="size-4 rounded border-input accent-brand"
                  />
                  {SERVICE_LABELS[service]}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              What you actually do for this client. Only these count towards
              their health score, so a client you have never done social for is
              not marked down for having no posts scheduled.
            </p>
            {state?.fieldErrors?.services ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.services[0]}
              </p>
            ) : null}
          </fieldset>

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
              Where this client&rsquo;s posts live publicly. Stored for
              reference: social captions are self-contained, so this is not
              added to them.
            </p>
            {state?.fieldErrors?.blog_base_url ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.blog_base_url[0]}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="client-deploy-hook"
              className="text-sm font-medium"
            >
              Deploy hook{" "}
              <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="client-deploy-hook"
              name="deploy_hook_url"
              type="url"
              inputMode="url"
              value={deployHookUrl}
              onChange={(event) => setDeployHookUrl(event.target.value)}
              disabled={removeDeployHook}
              placeholder={
                hasDeployHook
                  ? "Paste a new URL to replace the saved one"
                  : "https://api.vercel.com/v1/integrations/deploy/..."
              }
              className={`${fieldInputClass} disabled:opacity-50`}
            />
            <p className="text-xs text-muted-foreground">
              Only needed for static sites that rebuild to pick up new posts.
              Leave blank if the site fetches posts live.
            </p>
            {hasDeployHook ? (
              <div className="space-y-1.5 pt-0.5">
                <p className="text-xs text-muted-foreground">
                  A hook is saved. It is stored encrypted, so it is not shown
                  here. Leave this blank to keep it.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="deploy_hook_remove"
                    checked={removeDeployHook}
                    onChange={(event) => {
                      setRemoveDeployHook(event.target.checked);
                      if (event.target.checked) setDeployHookUrl("");
                    }}
                    className="size-4 rounded border-input accent-brand"
                  />
                  Remove the saved hook
                </label>
              </div>
            ) : null}
            {state?.fieldErrors?.deploy_hook_url ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.deploy_hook_url[0]}
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
