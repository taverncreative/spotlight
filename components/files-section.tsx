import { FileUpload } from "@/components/file-upload";
import { FileDownloadButton } from "@/components/file-download-button";
import { FileDeleteDialog } from "@/components/file-delete-dialog";
import { SectionCard, sectionRowClass } from "@/components/section-card";
import { hasPermission } from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAccess } from "@/lib/workspace";
import type { RELATED_TYPES } from "@/lib/files/schemas";
import { listFiles } from "@/app/app/[orgSlug]/files/actions";
import { deleteLinkedFileFormAction } from "@/app/app/[orgSlug]/files/form-actions";

// The per-record files section (Pass 8C), shared by the lead, customer and quote
// detail pages and mirroring the notes and tasks sections. It lists the record's
// files newest first (listFiles already orders by created_at desc), each with
// filename, size, type, uploader and timestamp. All members get a download
// control; write-capable roles also get an upload control (the browser-direct
// flow) and a permanent-delete confirm. read_only sees the list and download
// only. The detail page has already gated the record's module (it loaded the
// record), which is also the module listFiles gates on, so no extra guard here.

type RelatedType = (typeof RELATED_TYPES)[number];

type FileRow = {
  id: string;
  filename: string;
  size_bytes: number;
  mime_type: string | null;
  created_by: string | null;
  created_at: string;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib < 10 ? kib.toFixed(1) : Math.round(kib)} KB`;
  const mib = kib / 1024;
  return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MB`;
}

export async function FilesSection({
  orgSlug,
  recordType,
  recordId,
  detailHref,
}: {
  orgSlug: string;
  recordType: RelatedType;
  recordId: string;
  detailHref: string;
}) {
  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  const files = (await listFiles(orgSlug, {
    related_type: recordType,
    related_id: recordId,
  })) as FileRow[];

  // Resolve uploader names through the co-member-visible read of public.users
  // (migration 0025), the same mechanism the notes section uses, scoped to just
  // the uploaders present; full_name falls back to email.
  const uploaderIds = [
    ...new Set(
      files.map((f) => f.created_by).filter((v): v is string => Boolean(v))
    ),
  ];
  const nameById = new Map<string, string>();
  if (uploaderIds.length) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("users")
      .select("id, full_name, email")
      .in("id", uploaderIds);
    for (const u of (data ?? []) as {
      id: string;
      full_name: string | null;
      email: string | null;
    }[]) {
      nameById.set(u.id, u.full_name?.trim() || u.email || "Unknown");
    }
  }

  const uploaderName = (file: FileRow) =>
    file.created_by ? nameById.get(file.created_by) ?? "Unknown" : "Unknown";

  return (
    <SectionCard title="Files">
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <ul className="space-y-3">
          {files.map((file) => (
            <li key={file.id}>
              <div className={sectionRowClass}>
                <div className="space-y-1 text-sm">
                  <p className="break-all font-medium">{file.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(file.size_bytes)} {"·"}{" "}
                    {file.mime_type ?? "Unknown type"} {"·"} {uploaderName(file)}{" "}
                    {"·"} {formatDateTime(file.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <FileDownloadButton
                    orgSlug={orgSlug}
                    fileId={file.id}
                    filename={file.filename}
                  />
                  {canWrite ? (
                    <FileDeleteDialog
                      filename={file.filename}
                      action={deleteLinkedFileFormAction.bind(
                        null,
                        orgSlug,
                        file.id,
                        detailHref
                      )}
                    />
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <FileUpload
          orgSlug={orgSlug}
          recordType={recordType}
          recordId={recordId}
        />
      ) : null}
    </SectionCard>
  );
}
