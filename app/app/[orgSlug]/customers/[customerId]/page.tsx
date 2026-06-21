import Link from "next/link";
import { redirect } from "next/navigation";
import { ContactDeleteDialog } from "@/components/contact-delete-dialog";
import { ContactForm } from "@/components/contact-form";
import { DeleteRecordDialog } from "@/components/delete-record-dialog";
import { RestoreRecordButton } from "@/components/restore-record-button";
import { SetPrimaryButton } from "@/components/set-primary-button";
import { SiteForm } from "@/components/site-form";
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
import { SectionCard, sectionRowClass } from "@/components/section-card";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import { goneMessage } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { getCustomer } from "../actions";
import { softDeleteCustomerFormAction } from "../form-actions";
import { listContacts } from "@/app/app/[orgSlug]/contacts/actions";
import {
  createContactFormAction,
  deleteContactFormAction,
  setContactPrimaryFormAction,
  updateContactFormAction,
} from "@/app/app/[orgSlug]/contacts/form-actions";
import { listDeletedSites, listSites } from "@/app/app/[orgSlug]/sites/actions";
import {
  createSiteFormAction,
  restoreSiteFormAction,
  softDeleteSiteFormAction,
  updateSiteFormAction,
} from "@/app/app/[orgSlug]/sites/form-actions";

type Customer = {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
  created_at: string;
  updated_at: string;
};

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  is_primary: boolean;
};

type Site = {
  id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
  access_notes: string | null;
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

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; customerId: string }>;
  searchParams: Promise<{
    editContact?: string;
    editSite?: string;
    deletedSites?: string;
    editTask?: string;
    editNote?: string;
  }>;
}) {
  const { orgSlug, customerId } = await params;
  const { editContact, editSite, deletedSites, editTask, editNote } =
    await searchParams;
  const { membership } = await requireWorkspaceAccess(orgSlug);

  let customer: Customer | null;
  try {
    customer = (await getCustomer(orgSlug, {
      id: customerId,
    })) as Customer | null;
  } catch (error) {
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  if (!customer) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {goneMessage("customer")}
        </p>
        <Link
          href={`/app/${orgSlug}/customers`}
          className="text-sm underline underline-offset-4"
        >
          Back to customers
        </Link>
      </div>
    );
  }

  const canWrite = hasPermission(membership, "record.write");
  const detailHref = `/app/${orgSlug}/customers/${customerId}`;

  const contacts = ((await listContacts(orgSlug, { customer_id: customerId })) ??
    []) as Contact[];
  const sites = ((await listSites(orgSlug, { customer_id: customerId })) ??
    []) as Site[];
  const deletedSiteRows = deletedSites
    ? (((await listDeletedSites(orgSlug, { customer_id: customerId })) ??
        []) as Site[])
    : [];

  const addressParts = [
    customer.address_line1,
    customer.address_line2,
    customer.town,
    customer.county,
    customer.postcode,
  ].filter(Boolean);

  return (
    <RecordDetailShell
      title={customer.name}
      status={<Badge variant="secondary">{customer.type}</Badge>}
      actions={
        canWrite ? (
          <>
            <Link
              href={`/app/${orgSlug}/customers/${customer.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Edit
            </Link>
            <DeleteRecordDialog
              action={softDeleteCustomerFormAction.bind(
                null,
                orgSlug,
                customer.id
              )}
              entity="customer"
              itemName={customer.name}
            />
          </>
        ) : null
      }
      fields={
        <>
          <DetailFields>
            <DetailField label="Email" value={customer.email} />
            <DetailField label="Phone" value={customer.phone} />
            <DetailField
              label="Created"
              value={formatDateTime(customer.created_at)}
            />
            <DetailField
              label="Updated"
              value={formatDateTime(customer.updated_at)}
            />
          </DetailFields>
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">Address</p>
            {addressParts.length ? (
              <p className="whitespace-pre-line">{addressParts.join("\n")}</p>
            ) : (
              <p className="text-muted-foreground">Not set</p>
            )}
          </div>
        </>
      }
      backHref={`/app/${orgSlug}/customers`}
      backLabel="Back to customers"
    >
      <SectionCard title="Contacts">
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contacts yet.</p>
        ) : (
          <ul className="space-y-3">
            {contacts.map((contact) => (
              <li key={contact.id}>
                {canWrite && editContact === contact.id ? (
                  <ContactForm
                    idPrefix="edit-contact"
                    ariaLabel="Edit contact"
                    submitLabel="Save"
                    initial={contact}
                    cancelHref={detailHref}
                    action={updateContactFormAction.bind(
                      null,
                      orgSlug,
                      customerId,
                      contact.id
                    )}
                  />
                ) : (
                  <div className={sectionRowClass}>
                    <div className="space-y-0.5 text-sm">
                      <p className="flex items-center gap-2 font-medium">
                        {contact.name}
                        {contact.is_primary ? (
                          <Badge variant="secondary">Primary</Badge>
                        ) : null}
                      </p>
                      {contact.job_title ? (
                        <p className="text-muted-foreground">
                          {contact.job_title}
                        </p>
                      ) : null}
                      {contact.email ? (
                        <p className="text-muted-foreground">{contact.email}</p>
                      ) : null}
                      {contact.phone ? (
                        <p className="text-muted-foreground">{contact.phone}</p>
                      ) : null}
                    </div>
                    {canWrite ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {!contact.is_primary ? (
                          <SetPrimaryButton
                            action={setContactPrimaryFormAction.bind(
                              null,
                              orgSlug,
                              customerId,
                              contact.id
                            )}
                          />
                        ) : null}
                        <Link
                          href={`${detailHref}?editContact=${contact.id}`}
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                        >
                          Edit
                        </Link>
                        <ContactDeleteDialog
                          contactName={contact.name}
                          action={deleteContactFormAction.bind(
                            null,
                            orgSlug,
                            customerId,
                            contact.id
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
          <ContactForm
            idPrefix="add-contact"
            ariaLabel="Add contact"
            submitLabel="Add contact"
            action={createContactFormAction.bind(null, orgSlug, customerId)}
          />
        ) : null}
      </SectionCard>

      <SectionCard
        title="Sites"
        action={
          deletedSites ? (
            <Link
              href={detailHref}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Back to sites
            </Link>
          ) : (
            <Link
              href={`${detailHref}?deletedSites=1`}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Deleted sites
            </Link>
          )
        }
      >
        {deletedSites ? (
          <>
            <p className="text-sm font-medium">Deleted sites</p>
            {deletedSiteRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No deleted sites.</p>
            ) : (
              <ul className="space-y-3">
                {deletedSiteRows.map((site) => (
                  <li key={site.id} className={sectionRowClass}>
                    <SiteInfo site={site} />
                    {canWrite ? (
                      <RestoreRecordButton
                        action={restoreSiteFormAction.bind(
                          null,
                          orgSlug,
                          customerId,
                          site.id
                        )}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {sites.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sites yet.</p>
            ) : (
              <ul className="space-y-3">
                {sites.map((site) => (
                  <li key={site.id}>
                    {canWrite && editSite === site.id ? (
                      <SiteForm
                        idPrefix="edit-site"
                        ariaLabel="Edit site"
                        submitLabel="Save"
                        initial={site}
                        cancelHref={detailHref}
                        action={updateSiteFormAction.bind(
                          null,
                          orgSlug,
                          customerId,
                          site.id
                        )}
                      />
                    ) : (
                      <div className={sectionRowClass}>
                        <SiteInfo site={site} />
                        {canWrite ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`${detailHref}?editSite=${site.id}`}
                              className={buttonVariants({
                                variant: "outline",
                                size: "sm",
                              })}
                            >
                              Edit
                            </Link>
                            <DeleteRecordDialog
                              entity="site"
                              itemName={site.name}
                              action={softDeleteSiteFormAction.bind(
                                null,
                                orgSlug,
                                customerId,
                                site.id
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
              <SiteForm
                idPrefix="add-site"
                ariaLabel="Add site"
                submitLabel="Add site"
                action={createSiteFormAction.bind(null, orgSlug, customerId)}
              />
            ) : null}
          </>
        )}
      </SectionCard>

      <TasksSection
        orgSlug={orgSlug}
        recordType="customer"
        recordId={customerId}
        detailHref={detailHref}
        editTaskId={editTask}
      />

      <NotesSection
        orgSlug={orgSlug}
        recordType="customer"
        recordId={customerId}
        detailHref={detailHref}
        editNoteId={editNote}
      />

      <FilesSection
        orgSlug={orgSlug}
        recordType="customer"
        recordId={customerId}
        detailHref={detailHref}
      />
    </RecordDetailShell>
  );
}

function SiteInfo({ site }: { site: Site }) {
  const address = [
    site.address_line1,
    site.address_line2,
    site.town,
    site.county,
    site.postcode,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="space-y-0.5 text-sm">
      <p className="font-medium">{site.name}</p>
      {address ? <p className="text-muted-foreground">{address}</p> : null}
      {site.access_notes ? (
        <p className="text-muted-foreground">Access: {site.access_notes}</p>
      ) : null}
    </div>
  );
}
