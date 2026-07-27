import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth/require-user";

// The operator home shell: auth gate, then the shared app header.
//
// No client selector here, unlike the client shell: this page IS the roster, so
// a dropdown of the same clients above it would be a second way to do what the
// grid already does. The client-list query went with it.
export default async function HomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
