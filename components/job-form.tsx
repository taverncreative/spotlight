"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import { RepeatFields, type RepeatInitial } from "@/components/repeat-fields";
import { JOB_STATUSES } from "@/lib/jobs/schemas";
import type { FormState } from "@/lib/form-state";

type Customer = { id: string; name: string };
type Site = { id: string; name: string; customer_id: string };
type Member = { id: string; name: string };

type JobFormValues = {
  title?: string | null;
  description?: string | null;
  customer_id?: string | null;
  site_id?: string | null;
  scheduled_start?: string | null;
  assigned_to?: string | null;
  status?: string;
};

// When the job being edited belongs to a series, the form offers the classic
// three-way scope and (for the series-level scopes) the repeat rule.
type SeriesContext = { id: string; rule: RepeatInitial };

const STATUS_LABELS: Record<string, string> = {
  unscheduled: "Unscheduled",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

// One form for create and edit. The site picker is scoped to the chosen
// customer, filtered client-side from the organisation's sites; changing the
// customer clears a site that does not belong to the new one (the action and the
// composite FK are the backstops). A datetime-local sets the scheduled start; the
// form-action normalises it to an ISO datetime. The action validates the assignee
// as a co-member and the site as belonging to the customer.
export function JobForm({
  action,
  customers,
  sites,
  members,
  submitLabel,
  initial = {},
  cancelHref,
  allowRepeat = false,
  series = null,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  customers: Customer[];
  sites: Site[];
  members: Member[];
  submitLabel: string;
  initial?: JobFormValues;
  cancelHref?: string;
  // Create form: offer a "Repeats" toggle that reveals the rule.
  allowRepeat?: boolean;
  // Edit form: the job belongs to this series, so offer the three-way scope.
  series?: SeriesContext | null;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [customerId, setCustomerId] = useState(initial.customer_id ?? "");
  const [siteId, setSiteId] = useState(initial.site_id ?? "");
  const [repeat, setRepeat] = useState(false);
  const [scope, setScope] = useState<"occurrence" | "following" | "series">(
    "occurrence"
  );

  const customerSites = sites.filter((s) => s.customer_id === customerId);
  // The stored scheduled_start is an ISO datetime; a datetime-local wants
  // "YYYY-MM-DDTHH:mm".
  const startValue = initial.scheduled_start
    ? initial.scheduled_start.slice(0, 16)
    : "";

  function onCustomerChange(id: string) {
    setCustomerId(id);
    if (!sites.some((s) => s.id === siteId && s.customer_id === id)) {
      setSiteId("");
    }
  }

  return (
    <form action={formAction} aria-label="Job" className="space-y-5">
      {state?.formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.formError}
        </p>
      ) : null}

      <FormField label="Title" name="title" errors={state?.fieldErrors?.title}>
        <input
          id="title"
          name="title"
          defaultValue={initial.title ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Customer"
        name="customer_id"
        errors={state?.fieldErrors?.customer_id}
      >
        <select
          id="customer_id"
          name="customer_id"
          value={customerId}
          onChange={(event) => onCustomerChange(event.target.value)}
          className={fieldInputClass}
        >
          <option value="">Select a customer</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Site" name="site_id" errors={state?.fieldErrors?.site_id}>
        <select
          id="site_id"
          name="site_id"
          value={siteId}
          onChange={(event) => setSiteId(event.target.value)}
          disabled={customerSites.length === 0}
          className={fieldInputClass}
        >
          <option value="">
            {customerSites.length === 0 ? "No sites for this customer" : "No site"}
          </option>
          {customerSites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        label="Scheduled start"
        name="scheduled_start"
        errors={state?.fieldErrors?.scheduled_start}
      >
        <input
          id="scheduled_start"
          name="scheduled_start"
          type="datetime-local"
          defaultValue={startValue}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Assignee"
        name="assigned_to"
        errors={state?.fieldErrors?.assigned_to}
      >
        <select
          id="assigned_to"
          name="assigned_to"
          defaultValue={initial.assigned_to ?? ""}
          className={fieldInputClass}
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Status" name="status" errors={state?.fieldErrors?.status}>
        <select
          id="status"
          name="status"
          defaultValue={initial.status ?? "unscheduled"}
          className={fieldInputClass}
        >
          {JOB_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        label="Description"
        name="description"
        errors={state?.fieldErrors?.description}
      >
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={initial.description ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      {allowRepeat ? (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="repeat"
              checked={repeat}
              onChange={(event) => setRepeat(event.target.checked)}
            />
            Repeats
          </label>
          {repeat ? (
            <RepeatFields
              errors={{
                until_date: state?.fieldErrors?.until_date,
                occurrence_count: state?.fieldErrors?.occurrence_count,
                interval: state?.fieldErrors?.interval,
              }}
            />
          ) : null}
        </div>
      ) : null}

      {series ? (
        <div className="space-y-3">
          <input type="hidden" name="series_id" value={series.id} />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Apply changes to</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                value="occurrence"
                checked={scope === "occurrence"}
                onChange={() => setScope("occurrence")}
              />
              This occurrence only
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                value="following"
                checked={scope === "following"}
                onChange={() => setScope("following")}
              />
              This and all following
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                value="series"
                checked={scope === "series"}
                onChange={() => setScope("series")}
              />
              The entire series
            </label>
          </fieldset>
          {scope === "occurrence" ? (
            <p className="text-xs text-muted-foreground">
              This occurrence will be detached from the series and changed on its
              own; future series changes will leave it alone.
            </p>
          ) : (
            <RepeatFields
              initial={series.rule}
              errors={{
                until_date: state?.fieldErrors?.until_date,
                occurrence_count: state?.fieldErrors?.occurrence_count,
                interval: state?.fieldErrors?.interval,
              }}
            />
          )}
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
        {cancelHref ? (
          <Link
            href={cancelHref}
            className={buttonVariants({ variant: "outline" })}
          >
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}
