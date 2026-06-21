import Link from "next/link";

// The shared shell for a create/edit form page (the form analogue of
// ListScreen): a constrained column with a back link, a header (title and an
// optional description), then the form in a soft card. It matches the look the
// new-quote page established, so every form page reads the same. The form
// component passed as children owns its fields and primary action; it should
// fill the card (no width of its own).
export function FormScreen({
  backHref,
  backLabel,
  title,
  description,
  children,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={backHref}
        className="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {backLabel}
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-soft">{children}</div>
    </div>
  );
}
