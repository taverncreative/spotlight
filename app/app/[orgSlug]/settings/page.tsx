import { redirect } from "next/navigation";

// Settings has one section for now (Branding); the index sends there so the
// /settings URL always resolves. Branding enforces the admin-only gate.
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/settings/branding`);
}
