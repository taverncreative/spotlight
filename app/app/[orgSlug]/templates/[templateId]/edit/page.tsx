import Link from "next/link";
import { TemplateForm } from "@/components/template-form";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { goneMessage, NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { getTemplate } from "../../actions";
import { updateTemplateFormAction } from "../../form-actions";

type TemplateRecord = {
  id: string;
  name: string;
  category: string;
  subject: string | null;
  body: string;
};

// The edit form. Gated like the create page; the hidden Edit control is a
// courtesy, this page and the action enforce.
export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ orgSlug: string; templateId: string }>;
}) {
  const { orgSlug, templateId } = await params;

  let template: TemplateRecord | null;
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "templates");
    requirePermission(membership, "record.write");
    template = (await getTemplate(orgSlug, { id: templateId })) as TemplateRecord | null;
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

  if (!template) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{goneMessage("template")}</p>
        <Link
          href={`/app/${orgSlug}/templates`}
          className="text-sm underline underline-offset-4"
        >
          Back to templates
        </Link>
      </div>
    );
  }

  const action = updateTemplateFormAction.bind(null, orgSlug, template.id);

  return (
    <div className="space-y-6">
      <Link
        href={`/app/${orgSlug}/templates`}
        className="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Back to templates
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-medium tracking-tight">Edit template</h1>
      </div>
      <TemplateForm
        action={action}
        ariaLabel="Edit template"
        initial={template}
        submitLabel="Save changes"
      />
    </div>
  );
}
