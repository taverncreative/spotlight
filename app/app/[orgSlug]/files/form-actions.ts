"use server";

import { revalidatePath } from "next/cache";
import {
  formStateFromError,
  goneMessage,
  type FormState,
} from "@/lib/form-state";
import { deleteFile } from "./actions";

// Form-facing wrapper around deleteFile for the per-record FilesSection (Pass
// 8C), mirroring the linked note delete. Upload and download are browser-direct
// client flows (they need the user session against storage), so only the delete
// goes through a server form-action; it revalidates the record so the list
// refreshes in place.

const FILE_GONE = goneMessage("file");

export async function deleteLinkedFileFormAction(
  orgSlug: string,
  fileId: string,
  detailHref: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  try {
    const deleted = await deleteFile(orgSlug, { id: fileId });
    if (!deleted) return { formError: FILE_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(detailHref);
  return null;
}
