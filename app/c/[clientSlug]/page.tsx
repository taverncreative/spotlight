import { redirect } from "next/navigation";

// /c/[clientSlug] with no module lands on the overview module.
export default async function ClientIndexPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  redirect(`/c/${clientSlug}/overview`);
}
