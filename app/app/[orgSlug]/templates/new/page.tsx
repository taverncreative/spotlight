import Link from "next/link";
import { TemplateForm } from "@/components/template-form";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { createTemplateFormAction } from "../form-actions";

// The create form. The page gate mirrors the action's: hiding the New template
// button is a courtesy, this page (and the action beneath it) enforce.
export default async function NewTemplatePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "templates");
    requirePermission(membership, "record.write");
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return (
        <p role="alert" className="text-sm text-muted-foreground">
          {NO_PERMISSION_MESSAGE}
        </p>
      );
    }
    throw error;
  }

  const action = createTemplateFormAction.bind(null, orgSlug);

  return (
    <div className="space-y-6">
      <Link
        href={`/app/${orgSlug}/templates`}
        className="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Back to templates
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-medium tracking-tight">New template</h1>
        <p className="text-sm text-muted-foreground">
          Write reusable message content with placeholders filled from a record.
        </p>
      </div>
      <TemplateForm
        action={action}
        ariaLabel="New template"
        submitLabel="Create template"
      />
    </div>
  );
}
