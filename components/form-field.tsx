// Shared labelled field wrapper for module forms (leads, customers), with
// the first Zod field error shown inline beneath the control.
export function FormField({
  label,
  name,
  errors,
  children,
}: {
  label: string;
  name: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {errors?.length ? (
        <p className="text-sm text-destructive">{errors[0]}</p>
      ) : null}
    </div>
  );
}

// Shared styling for text inputs, textareas and selects across the forms, so
// every control inherits the design system: a low-contrast border, a subtle
// dark-mode fill, gentle rounding and a brand-coloured focus ring.
export const fieldInputClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";
