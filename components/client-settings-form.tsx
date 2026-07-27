"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { initialsFrom } from "@/components/client-grid";
import { SERVICES, SERVICE_LABELS } from "@/lib/clients/health";
import { uploadClientLogo } from "@/lib/clients/logo-upload";
import {
  archiveClient,
  setClientLogo,
  updateClientSettings,
} from "@/lib/clients/settings-actions";
import { type ClientFormState } from "@/lib/clients/schemas";

// The client's configuration, moved off the Add/Edit dialog.
//
// The dialog had reached eight fields, and most of them were not what you need
// to create a client: they were decisions about how we work for one that already
// exists. A modal is the wrong shape for those. Here each has room for a
// sentence saying what it does and what happens if it is left blank, which is
// what a deploy hook and a services list actually need.

// One labelled block. The description sits under the heading rather than beside
// the control, so a long explanation does not squeeze the input.
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-card border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function ClientSettingsForm({
  clientId,
  clientSlug,
  clientName,
  blogBaseUrl: initialBlogBaseUrl,
  deployHookHint,
  services: initialServices,
  logoUrl: initialLogoUrl,
}: {
  clientId: string;
  clientSlug: string;
  clientName: string;
  blogBaseUrl: string | null;
  // A masked fragment of the stored hook (host plus the last four characters of
  // the path), or null when none is saved. Computed on the server; the URL
  // itself never reaches the browser.
  deployHookHint: string | null;
  services: string[];
  logoUrl: string | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    ClientFormState,
    FormData
  >(updateClientSettings, null);

  const [services, setServices] = useState<string[]>(initialServices);
  const [blogBaseUrl, setBlogBaseUrl] = useState(initialBlogBaseUrl ?? "");
  const [deployHookUrl, setDeployHookUrl] = useState("");
  const [removeDeployHook, setRemoveDeployHook] = useState(false);

  const [logoUrl, setLogoUrl] = useState(initialLogoUrl ?? "");
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // The upload runs browser-to-storage and the result is saved immediately,
  // rather than waiting for the Save button further down the page. Storage RLS
  // (0065) is the write gate, keyed on the client-id folder; the server never
  // handles the bytes, only the resulting URL.
  async function commitLogo(url: string | null) {
    setLogoBusy(true);
    setLogoError(null);
    const result = await setClientLogo(clientId, url);
    setLogoBusy(false);
    if (!result.ok) {
      setLogoError(result.error ?? "Could not save the logo.");
      return;
    }
    setLogoUrl(url ?? "");
    router.refresh();
  }

  async function handleLogoFile(file: File | undefined) {
    if (!file) return;
    setLogoBusy(true);
    setLogoError(null);
    const result = await uploadClientLogo(file, clientId);
    if (!result.ok) {
      setLogoBusy(false);
      setLogoError(result.error);
      return;
    }
    await commitLogo(result.url);
  }

  return (
    <div className="space-y-4">
      <Section
        title="Logo"
        description="Shown on this client's card. Saves as soon as you choose a file, not on the button below. PNG, JPEG or WebP under 2 MB; SVG is not accepted because it can carry script. Without one the card falls back to initials."
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-control bg-brand/10 text-sm font-semibold tracking-wide text-brand">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="size-full object-cover" />
            ) : (
              initialsFrom(clientName)
            )}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={logoBusy}
            onChange={(event) => {
              void handleLogoFile(event.target.files?.[0]);
              event.target.value = "";
            }}
            className="max-w-[15rem] text-xs file:mr-2 file:rounded-control file:border file:border-input file:bg-secondary file:px-2 file:py-1 file:text-xs"
          />
          {logoUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={logoBusy}
              onClick={() => void commitLogo(null)}
            >
              Remove
            </Button>
          ) : null}
          {logoBusy ? (
            <span className="text-xs text-muted-foreground">Saving…</span>
          ) : null}
        </div>
        {logoError ? (
          <p className="text-sm text-destructive">{logoError}</p>
        ) : null}
      </Section>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="id" value={clientId} />
        <input type="hidden" name="slug" value={clientSlug} />

        <Section
          title="Services"
          description="What you actually do for this client. Only these count towards their health score, so a client you have never done social for is not marked down for having nothing scheduled. Leave everything unticked and the card shows no score at all rather than a bad one."
        >
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SERVICES.map((service) => (
              <label key={service} className="flex items-center gap-2 text-sm">
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
          {state?.fieldErrors?.services ? (
            <p className="text-sm text-destructive">
              {state.fieldErrors.services[0]}
            </p>
          ) : null}
        </Section>

        <Section
          title="Blog base URL"
          description="Where this client's posts live publicly, used to build a link to a published post. Blank means we do not know, and nothing guesses a path."
        >
          <input
            name="blog_base_url"
            type="url"
            inputMode="url"
            value={blogBaseUrl}
            onChange={(event) => setBlogBaseUrl(event.target.value)}
            placeholder="https://businesssortedkent.co.uk/news"
            className={fieldInputClass}
          />
          {state?.fieldErrors?.blog_base_url ? (
            <p className="text-sm text-destructive">
              {state.fieldErrors.blog_base_url[0]}
            </p>
          ) : null}
        </Section>

        <Section
          title="Deploy hook"
          description="Only needed for static sites that rebuild to pick up new posts. Publishing, editing or unpublishing a post triggers a rebuild. Leave blank if the site fetches posts live."
        >
          {deployHookHint ? (
            <p className="flex flex-wrap items-baseline gap-2 text-xs">
              <span className="text-muted-foreground">Saved:</span>
              <span className="rounded-control bg-secondary px-2 py-1 font-mono text-foreground">
                {deployHookHint}
              </span>
            </p>
          ) : null}
          <input
            name="deploy_hook_url"
            type="url"
            inputMode="url"
            value={deployHookUrl}
            onChange={(event) => setDeployHookUrl(event.target.value)}
            disabled={removeDeployHook}
            placeholder={
              deployHookHint
                ? "Paste a new URL to replace the saved one"
                : "https://api.vercel.com/v1/integrations/deploy/..."
            }
            className={`${fieldInputClass} disabled:opacity-50`}
          />
          {deployHookHint ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                A hook is saved. It is stored encrypted, so only enough of it is
                shown to recognise. Leave the field blank to keep it.
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
        </Section>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving" : "Save settings"}
          </Button>
          {state?.ok ? (
            <span className="text-sm text-muted-foreground">Saved.</span>
          ) : null}
          {state?.error ? (
            <span role="alert" className="text-sm text-destructive">
              {state.error}
            </span>
          ) : null}
        </div>
      </form>

      {/* Outside the form above: a form inside a form is invalid HTML, and this
          is a different kind of action from saving a field. */}
      <Section
        title="Archive"
        description="For a client you no longer work for but might again. They leave the client grid, the client selector and the assign dropdowns, and their module pages stop resolving. Nothing is deleted and you can restore them from the archived list on the home page, which is also the only place they can be deleted permanently."
      >
        <form action={archiveClient}>
          <input type="hidden" name="id" value={clientId} />
          <Button type="submit" variant="outline">
            Archive {clientName}
          </Button>
        </form>
      </Section>
    </div>
  );
}
