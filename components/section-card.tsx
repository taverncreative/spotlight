import { cn } from "@/lib/utils";

// A consistent titled card for a record-detail section (Contacts, Sites, Tasks,
// Notes, Files, and any future section). It renders a <section> labelled by its
// heading, so the per-record section components and the detail pages all share
// one calm card surface. The optional action sits on the heading row (for
// example the "Deleted sites" link).
export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "space-y-4 rounded-xl border bg-card p-5 shadow-soft",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-base font-medium">
          {title}
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

// Shared styling for a row inside a section card (a contact, site, task, note or
// file). A soft inset surface, no heavy border, so a card of rows reads calmly.
export const sectionRowClass =
  "flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted/40 p-4";
