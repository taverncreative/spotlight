// Shared pieces for the workspace logo (Branding settings, part 2). Pure, no
// server-only imports, so the upload action, the quote PDF builder and the
// storage/seed paths can all reuse them.

// The logos storage bucket (migration 0045). Public-read; writes admin-only and
// own-org-scoped.
export const LOGO_BUCKET = "logos";

// Maximum logo size. KEEP IN STEP with the logos bucket file_size_limit in
// migration 0045 (2 MiB), which is the unbypassable cap; this is the friendly
// pre-check in the upload action.
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

// The accepted image types. pdf-lib embeds raster (PNG/JPEG), not SVG, and the
// same raster serves the shell, the public quote page and the PDF, so we accept
// only these two.
export type LogoImageType = "png" | "jpeg";

// Detect the actual image type from the file's magic bytes, not the claimed MIME
// or extension, so a renamed or mislabelled file (or an SVG) cannot get through.
// Returns null for anything that is not a real PNG or JPEG.
export function detectImageType(bytes: Uint8Array): LogoImageType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg";
  }
  return null;
}

// The object path inside the logos bucket for a stored public URL, or null when
// the URL is not one of ours (an external or legacy /public asset), so a caller
// replacing or clearing the logo only ever tries to delete an object it owns.
export function logoStoragePath(
  publicUrl: string | null | undefined
): string | null {
  if (!publicUrl) return null;
  const marker = `/storage/v1/object/public/${LOGO_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(publicUrl.slice(index + marker.length));
}
