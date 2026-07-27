import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth/require-user";

// Operator-level retainer-time shell: auth gate, then the standard top bar,
// mirroring the due and email shells. Not client-scoped: this view spans every
// client's hours, so it carries no client selector and no module bar.
export default async function TimeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Memoised per request, so anything else in this render that needs the user
  // shares the one auth round-trip rather than making its own.
  await requireUser();

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
