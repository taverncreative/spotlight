import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { CopyHtmlForm } from "@/components/copy-html-form";
import { CopyWebhookUrl } from "@/components/copy-webhook-url";
import { CreateWebhookForm } from "@/components/create-webhook-form";
import { RegenerateTokenDialog } from "@/components/regenerate-token-dialog";
import { WebhookFormStatusButton } from "@/components/webhook-form-status-button";
import { EmptyState } from "@/components/list-screen";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import { HONEYPOT_FIELD } from "@/lib/lead-webhooks/intake";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listWebhookForms } from "./actions";
import {
  createWebhookFormFormAction,
  regenerateWebhookFormTokenFormAction,
  setWebhookFormStatusFormAction,
} from "./form-actions";

type WebhookForm = {
  id: string;
  name: string;
  status: "active" | "disabled";
  token: string;
  created_at: string;
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function WebhookFormsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canManage = hasPermission(membership, "settings.manage");

  // The absolute base URL the public endpoint is served on, from the request
  // host, so each form's copyable HTML carries a ready-to-paste action URL.
  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  let forms: WebhookForm[];
  try {
    forms = (await listWebhookForms(orgSlug)) as WebhookForm[];
  } catch (error) {
    // No leads entitlement: back to the workspace overview, like the leads
    // list does. Anything else is a real error.
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link
          href={`/app/${orgSlug}/leads`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to leads
        </Link>
        <h1 className="text-2xl font-medium tracking-tight">Web forms</h1>
        <p className="text-sm text-muted-foreground">
          Lead-capture forms you can wire into your website. A submission to a
          form&apos;s link arrives as a new lead.
        </p>
      </div>

      <section className="space-y-2 rounded-xl border bg-card p-5 text-sm shadow-soft">
        <h2 className="font-medium">Wiring up a form</h2>
        <p className="text-muted-foreground">
          The simplest way is a plain HTML form with no JavaScript: set its{" "}
          <code>method</code> to <code>post</code> and its <code>action</code>{" "}
          to a form&apos;s submission URL. Copy a ready-made one from any form
          below. These fields are recognised: <code>name</code>,{" "}
          <code>email</code>, <code>phone</code> and <code>message</code>;
          anything else you send is kept with the lead. Keep the hidden{" "}
          <code>{HONEYPOT_FIELD}</code> field that real visitors never see; if
          it is filled the submission is treated as spam.
        </p>
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            Prefer to post JSON with JavaScript?
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
            {`<form id="lead-form">
  <input name="name" />
  <input name="email" type="email" />
  <input name="phone" />
  <textarea name="message"></textarea>
  <!-- honeypot: keep hidden, leave blank -->
  <input name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off"
         aria-hidden="true" style="position:absolute;left:-5000px" />
  <button type="submit">Send</button>
</form>
<script>
  document.getElementById("lead-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    await fetch("YOUR-FORM-SUBMISSION-URL", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });
</script>`}
          </pre>
        </details>
      </section>

      {canManage ? (
        <CreateWebhookForm
          action={createWebhookFormFormAction.bind(null, orgSlug)}
        />
      ) : null}

      {forms.length === 0 ? (
        <EmptyState>
          No web forms yet.
          {canManage ? " Create one above to start capturing leads." : ""}
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {forms.map((form) => (
            <li
              key={form.id}
              className="space-y-3 rounded-xl border bg-card p-5 shadow-soft"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <p className="font-medium">{form.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {formatDate(form.created_at)}
                  </p>
                </div>
                <Badge variant={form.status === "active" ? "default" : "secondary"}>
                  {form.status}
                </Badge>
              </div>

              <CopyWebhookUrl token={form.token} />
              <CopyHtmlForm
                submissionUrl={`${baseUrl}/api/lead-webhooks/${form.token}`}
              />

              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  <WebhookFormStatusButton
                    status={form.status}
                    action={setWebhookFormStatusFormAction.bind(
                      null,
                      orgSlug,
                      form.id,
                      form.status === "active" ? "disabled" : "active"
                    )}
                  />
                  <RegenerateTokenDialog
                    action={regenerateWebhookFormTokenFormAction.bind(
                      null,
                      orgSlug,
                      form.id
                    )}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
