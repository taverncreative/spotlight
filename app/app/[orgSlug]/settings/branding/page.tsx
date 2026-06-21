import { redirect } from "next/navigation";
import { FormScreen } from "@/components/form-screen";
import { AuthorisationError, requirePermission } from "@/lib/authorisation";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { BrandingForm } from "./branding-form";
import { LogoForm } from "./logo-form";
import { setBrandColorFormAction, updateLogoFormAction } from "./actions";

// Branding settings, admin-only. The Settings nav entry is shown only to a
// client_admin (courtesy); this page enforces it, and the write beneath enforces
// it again at the database. A non-admin who reaches the URL directly is sent
// back to the workspace overview.
export default async function BrandingSettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
  try {
    requirePermission(membership, "settings.manage");
  } catch (error) {
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  return (
    <FormScreen
      backHref={`/app/${orgSlug}`}
      backLabel="Back to overview"
      title="Branding"
      description="Set your workspace brand colour. It themes the app and the quotes your customers see."
    >
      <div className="space-y-8">
        <BrandingForm
          action={setBrandColorFormAction.bind(null, orgSlug)}
          currentColor={organisation.brand_color ?? ""}
        />
        <div className="space-y-4 border-t pt-8">
          <div className="space-y-1">
            <h2 className="text-base font-medium">Logo</h2>
            <p className="text-sm text-muted-foreground">
              Shown in the app, on the public quote page and in the quote PDF.
            </p>
          </div>
          <LogoForm
            action={updateLogoFormAction.bind(null, orgSlug)}
            currentLogoUrl={organisation.logo_url ?? ""}
          />
        </div>
      </div>
    </FormScreen>
  );
}
