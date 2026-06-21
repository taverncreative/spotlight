import Link from "next/link";
import { redirect } from "next/navigation";
import { ConvertLeadDialog } from "@/components/convert-lead-dialog";
import { DeleteRecordDialog } from "@/components/delete-record-dialog";
import { TasksSection } from "@/components/tasks-section";
import { NotesSection } from "@/components/notes-section";
import { FilesSection } from "@/components/files-section";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  RecordDetailShell,
  DetailFields,
  DetailField,
} from "@/components/record-detail";
import {
  AuthorisationError,
  hasPermission,
  isModuleEnabled,
} from "@/lib/authorisation";
import { GONE_MESSAGE } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { getLead } from "../actions";
import {
  convertLeadFormAction,
  softDeleteLeadFormAction,
} from "../form-actions";

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string | null;
  status: string;
  converted_customer_id: string | null;
  created_at: string;
  updated_at: string;
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

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; leadId: string }>;
  searchParams: Promise<{ editTask?: string; editNote?: string }>;
}) {
  const { orgSlug, leadId } = await params;
  const { editTask, editNote } = await searchParams;
  const { organisation, membership } = await requireWorkspaceAccess(orgSlug);

  let lead: Lead | null;
  try {
    lead = (await getLead(orgSlug, { id: leadId })) as Lead | null;
  } catch (error) {
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  if (!lead) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{GONE_MESSAGE}</p>
        <Link
          href={`/app/${orgSlug}/leads`}
          className="text-sm underline underline-offset-4"
        >
          Back to leads
        </Link>
      </div>
    );
  }

  const canWrite = hasPermission(membership, "record.write");
  const customersEnabled = await isModuleEnabled(organisation, "customers");
  const isConverted =
    lead.status === "converted" || lead.converted_customer_id !== null;

  // The converted-to link shows the customer's name where readable.
  let convertedCustomerName: string | null = null;
  if (lead.converted_customer_id) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("customers")
      .select("name")
      .eq("id", lead.converted_customer_id)
      .maybeSingle();
    convertedCustomerName = data?.name ?? null;
  }

  const detailHref = `/app/${orgSlug}/leads/${lead.id}`;

  return (
    <RecordDetailShell
      title={lead.name ?? "Unnamed"}
      status={<Badge variant="secondary">{lead.status}</Badge>}
      meta={
        lead.converted_customer_id && customersEnabled ? (
          <p className="text-sm text-muted-foreground">
            Converted to{" "}
            <Link
              href={`/app/${orgSlug}/customers/${lead.converted_customer_id}`}
              className="underline underline-offset-4 hover:text-foreground"
            >
              {convertedCustomerName ?? "customer"}
            </Link>
          </p>
        ) : null
      }
      actions={
        canWrite ? (
          <>
            {customersEnabled && !isConverted ? (
              <ConvertLeadDialog
                action={convertLeadFormAction.bind(null, orgSlug, lead.id)}
                leadName={lead.name ?? "this lead"}
              />
            ) : null}
            <Link
              href={`/app/${orgSlug}/leads/${lead.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Edit
            </Link>
            <DeleteRecordDialog
              action={softDeleteLeadFormAction.bind(null, orgSlug, lead.id)}
              entity="lead"
              itemName={lead.name ?? "This lead"}
            />
          </>
        ) : null
      }
      fields={
        <>
          <DetailFields>
            <DetailField label="Email" value={lead.email} />
            <DetailField label="Phone" value={lead.phone} />
            <DetailField label="Source" value={lead.source} />
            <DetailField label="Created" value={formatDateTime(lead.created_at)} />
            <DetailField label="Updated" value={formatDateTime(lead.updated_at)} />
          </DetailFields>
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">Message</p>
            <p className="whitespace-pre-wrap">{lead.message || "No message."}</p>
          </div>
        </>
      }
      backHref={`/app/${orgSlug}/leads`}
      backLabel="Back to leads"
    >
      <TasksSection
        orgSlug={orgSlug}
        recordType="lead"
        recordId={lead.id}
        detailHref={detailHref}
        editTaskId={editTask}
      />

      <NotesSection
        orgSlug={orgSlug}
        recordType="lead"
        recordId={lead.id}
        detailHref={detailHref}
        editNoteId={editNote}
      />

      <FilesSection
        orgSlug={orgSlug}
        recordType="lead"
        recordId={lead.id}
        detailHref={detailHref}
      />
    </RecordDetailShell>
  );
}
