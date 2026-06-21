import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type WorkspaceRef = { name: string; slug: string };

// Lands here after sign-in. Sends single-workspace users straight to their
// workspace; shows a chooser for the few with more than one.
export default async function WorkspaceResolverPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("organisation_memberships")
    .select("organisations (name, slug)")
    .eq("user_id", user.id)
    .eq("status", "active");

  // Without generated database types the client cannot tell that this
  // many-to-one embed is a single object, so handle both shapes.
  const workspaces: WorkspaceRef[] = (data ?? []).flatMap((row) => {
    const org = row.organisations;
    if (!org) return [];
    return Array.isArray(org) ? org : [org];
  });

  if (workspaces.length === 1) {
    redirect(`/app/${workspaces[0].slug}`);
  }

  if (workspaces.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="max-w-sm text-center text-sm">
          Your account has no workspace yet. Contact Business Sorted Kent to be
          added to one.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Choose a workspace</h1>
        <ul className="space-y-2">
          {workspaces.map((workspace) => (
            <li key={workspace.slug}>
              <Link
                href={`/app/${workspace.slug}`}
                className="block rounded-md border border-input px-3 py-2 text-sm hover:bg-accent"
              >
                {workspace.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
