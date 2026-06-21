"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/authorisation";
import { sanitiseBrandColor } from "@/lib/brand";
import {
  LOGO_BUCKET,
  MAX_LOGO_BYTES,
  detectImageType,
  logoStoragePath,
} from "@/lib/logo";
import { formStateFromError } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAccess } from "@/lib/workspace";

// The branding settings state. Like FormState but with a success flag, since a
// settings save stays on the page and confirms rather than redirecting.
export type BrandingFormState = {
  formError?: string;
  fieldErrors?: Record<string, string[]>;
  success?: boolean;
} | null;

const INVALID_COLOUR = "Enter a valid hex colour, for example #5b5bd6.";

// Set the workspace brand colour. Admin-only: the action gates on settings.manage
// as a courtesy, but the write goes through the user session and is enforced at
// the database, not just here, by the organisations update policy (is_org_admin,
// own organisation only; migration 0003) and the column grant (brand_color only;
// migrations 0003 and 0044). It is a user-session RLS-enforced write, not a
// service-role surface. An empty value clears the colour back to the platform
// default (null); any other value must be a valid hex or it is rejected.
export async function setBrandColorFormAction(
  orgSlug: string,
  _previous: BrandingFormState,
  formData: FormData
): Promise<BrandingFormState> {
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    requirePermission(membership, "settings.manage");

    const raw = String(formData.get("brand_color") ?? "").trim();
    let brandColor: string | null;
    if (raw === "") {
      brandColor = null;
    } else {
      const sanitised = sanitiseBrandColor(raw);
      if (!sanitised) {
        return { fieldErrors: { brand_color: [INVALID_COLOUR] } };
      }
      brandColor = sanitised;
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("organisations")
      .update({ brand_color: brandColor })
      .eq("id", organisation.id);
    if (error) throw new Error(error.message);

    // Re-theme the shell: the workspace layout reads brand_color into --brand.
    revalidatePath(`/app/${orgSlug}`, "layout");
    return { success: true };
  } catch (error) {
    return formStateFromError(error);
  }
}

// The logo settings state: the colour state plus a cleared flag so the form can
// confirm a removal as well as an upload.
export type LogoFormState = {
  formError?: string;
  fieldErrors?: Record<string, string[]>;
  success?: boolean;
  cleared?: boolean;
} | null;

const LOGO_TYPE_ERROR = "Only PNG or JPEG images are allowed.";
const LOGO_MISSING_ERROR = "Choose a PNG or JPEG image to upload.";
const LOGO_SIZE_ERROR = "The image must be 2 MB or smaller.";

// Set or clear the workspace logo. Admin-only: the action gates on
// settings.manage, and the writes are enforced again at the database, the logo
// bytes by the logos bucket storage policies (a client_admin on their own org's
// path; migration 0045) and the logo_url column by the organisations update
// policy plus the column grant (migrations 0003 and 0046). The image is posted
// to this server action (not uploaded browser-direct) so its real content can be
// validated from the magic bytes, never just the claimed type or extension.
//
// intent=clear removes the logo (and best-effort deletes the stored object).
// Otherwise the uploaded file is validated (type, size), stored under
// organisation_id/logo-<uuid>.<ext>, and its public URL written to logo_url;
// any previous object is best-effort removed. The object always exists before
// logo_url points at it, so a failed metadata write leaves at most a harmless
// orphan, never a row pointing at a missing object (the files-actions invariant).
export async function updateLogoFormAction(
  orgSlug: string,
  _previous: LogoFormState,
  formData: FormData
): Promise<LogoFormState> {
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    requirePermission(membership, "settings.manage");
    const supabase = await createClient();
    const previousPath = logoStoragePath(organisation.logo_url);

    if (formData.get("intent") === "clear") {
      const { error } = await supabase
        .from("organisations")
        .update({ logo_url: null })
        .eq("id", organisation.id);
      if (error) throw new Error(error.message);
      if (previousPath) {
        await supabase.storage.from(LOGO_BUCKET).remove([previousPath]);
      }
      revalidatePath(`/app/${orgSlug}`, "layout");
      return { success: true, cleared: true };
    }

    const file = formData.get("logo");
    if (!(file instanceof File) || file.size === 0) {
      return { fieldErrors: { logo: [LOGO_MISSING_ERROR] } };
    }
    if (file.size > MAX_LOGO_BYTES) {
      return { fieldErrors: { logo: [LOGO_SIZE_ERROR] } };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectImageType(bytes);
    if (!type) {
      return { fieldErrors: { logo: [LOGO_TYPE_ERROR] } };
    }

    const ext = type === "png" ? "png" : "jpg";
    const path = `${organisation.id}/logo-${crypto.randomUUID()}.${ext}`;
    const uploaded = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(path, bytes, {
        contentType: type === "png" ? "image/png" : "image/jpeg",
      });
    if (uploaded.error) {
      return { formError: "The logo could not be uploaded. Please try again." };
    }

    const publicUrl = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data
      .publicUrl;
    const { error } = await supabase
      .from("organisations")
      .update({ logo_url: publicUrl })
      .eq("id", organisation.id);
    if (error) {
      // The metadata write failed: clean up the object so no orphan lingers.
      await supabase.storage.from(LOGO_BUCKET).remove([path]);
      throw new Error(error.message);
    }
    if (previousPath && previousPath !== path) {
      await supabase.storage.from(LOGO_BUCKET).remove([previousPath]);
    }

    revalidatePath(`/app/${orgSlug}`, "layout");
    return { success: true };
  } catch (error) {
    return formStateFromError(error);
  }
}
