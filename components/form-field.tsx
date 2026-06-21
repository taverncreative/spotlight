// Shared styling for text inputs across the app (currently the login form): a
// low-contrast border, a subtle dark-mode fill, gentle rounding and a
// brand-coloured focus ring.
export const fieldInputClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";
