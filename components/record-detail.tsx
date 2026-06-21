import Link from "next/link";

// The shared shell for a record-detail screen (Lead, Customer, and the other
// record screens later). It renders a back link, a header card (title, status
// badges, a meta line and the actions, then the record's key fields) and below
// it the section cards passed as children.
export function RecordDetailShell({
  title,
  status,
  meta,
  actions,
  fields,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  status?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  fields?: React.ReactNode;
  backHref: string;
  backLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={backHref}
        className="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {backLabel}
      </Link>

      <div className="space-y-5 rounded-xl border bg-card p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-1/2 space-y-2">
            <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
            {status ? (
              <div className="flex flex-wrap items-center gap-2">{status}</div>
            ) : null}
            {meta}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
        {fields}
      </div>

      {children}
    </div>
  );
}

// A labelled key/value grid for the record's fields, used inside the header card.
export function DetailFields({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
      {children}
    </dl>
  );
}

export function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || "Not set"}</dd>
    </div>
  );
}
