import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { NoteForm } from "@/components/note-form";
import { NoteDeleteDialog } from "@/components/note-delete-dialog";
import { SectionCard, sectionRowClass } from "@/components/section-card";
import { hasPermission } from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAccess } from "@/lib/workspace";
import type { RELATED_TYPES } from "@/lib/notes/schemas";
import { listNotes } from "@/app/app/[orgSlug]/notes/actions";
import {
  createLinkedNoteFormAction,
  deleteLinkedNoteFormAction,
  updateLinkedNoteFormAction,
} from "@/app/app/[orgSlug]/notes/form-actions";

// The per-record notes section (Pass 7B), shared by the lead, customer and
// quote detail pages and mirroring the tasks section. It lists the record's
// notes newest first (listNotes already orders by created_at desc), and for
// write-capable roles adds notes already linked to this record, plus an inline
// edit of the body and a permanent-delete confirm. read_only sees the notes
// only. The detail page has already gated the record's module (it loaded the
// record), which is also the module listNotes gates on, so no extra guard is
// needed here.

type RelatedType = (typeof RELATED_TYPES)[number];

type Note = {
  id: string;
  body: string;
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

export async function NotesSection({
  orgSlug,
  recordType,
  recordId,
  detailHref,
  editNoteId,
}: {
  orgSlug: string;
  recordType: RelatedType;
  recordId: string;
  detailHref: string;
  editNoteId?: string;
}) {
  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  const notes = (await listNotes(orgSlug, {
    related_type: recordType,
    related_id: recordId,
  })) as Note[];

  // Resolve author names through the co-member-visible read of public.users
  // (migration 0025), the same mechanism the tasks assignee picker uses, scoped
  // to just the authors present; full_name falls back to email.
  const authorIds = [
    ...new Set(notes.map((n) => n.created_by).filter((v): v is string => Boolean(v))),
  ];
  const nameById = new Map<string, string>();
  if (authorIds.length) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("users")
      .select("id, full_name, email")
      .in("id", authorIds);
    for (const u of (data ?? []) as {
      id: string;
      full_name: string | null;
      email: string | null;
    }[]) {
      nameById.set(u.id, u.full_name?.trim() || u.email || "Unknown");
    }
  }

  const authorName = (note: Note) =>
    note.created_by ? nameById.get(note.created_by) ?? "Unknown" : "Unknown";

  return (
    <SectionCard title="Notes">
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id}>
              {canWrite && editNoteId === note.id ? (
                <NoteForm
                  idPrefix="edit-note"
                  ariaLabel="Edit note"
                  submitLabel="Save"
                  initial={{ body: note.body }}
                  cancelHref={detailHref}
                  action={updateLinkedNoteFormAction.bind(
                    null,
                    orgSlug,
                    note.id,
                    detailHref
                  )}
                />
              ) : (
                <div className={sectionRowClass}>
                  <div className="space-y-1 text-sm">
                    <p className="whitespace-pre-wrap">{note.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {authorName(note)} {"·"} {formatDateTime(note.created_at)}
                    </p>
                  </div>
                  {canWrite ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`${detailHref}?editNote=${note.id}`}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        Edit
                      </Link>
                      <NoteDeleteDialog
                        action={deleteLinkedNoteFormAction.bind(
                          null,
                          orgSlug,
                          note.id,
                          detailHref
                        )}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <NoteForm
          idPrefix="add-note"
          ariaLabel="Add note"
          submitLabel="Add note"
          action={createLinkedNoteFormAction.bind(
            null,
            orgSlug,
            recordType,
            recordId,
            detailHref
          )}
        />
      ) : null}
    </SectionCard>
  );
}
