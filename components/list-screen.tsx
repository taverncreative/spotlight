// The shared shell for a module list screen (Leads, Customers, and the other
// lists that reuse it later): a header with the title, description and primary
// action, an optional toolbar (filters on the left, secondary links on the
// right), then the body. EmptyState is the matching empty-list panel.

export function ListScreen({
  title,
  description,
  action,
  filters,
  toolbarEnd,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  filters?: React.ReactNode;
  toolbarEnd?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {filters || toolbarEnd ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">{filters}</div>
          {toolbarEnd ? (
            <div className="flex flex-wrap items-center gap-4">{toolbarEnd}</div>
          ) : null}
        </div>
      ) : null}

      {children}
    </div>
  );
}

// The empty-list panel: a calm bordered card with the message centred.
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-6 py-16 text-center text-sm text-muted-foreground shadow-soft">
      {children}
    </div>
  );
}

// A card surface that wraps a data table so the list reads as one clean panel.
export function TableCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-soft">
      {children}
    </div>
  );
}
