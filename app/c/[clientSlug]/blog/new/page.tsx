import { requireClient } from "@/lib/clients/require-client";
import { PostForm } from "@/components/post-form";
import { seoContextForClient } from "@/lib/posts/seo-context";
import { parseDay } from "@/lib/calendar/grid";

export default async function NewPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  // ?date=YYYY-MM-DD, set when the operator got here by clicking a day on the
  // calendar. Validated for shape, so a hand-typed "?date=soon" lands on an
  // empty date field rather than in the form.
  searchParams: Promise<{ date?: string }>;
}) {
  const { clientSlug } = await params;
  const { date } = await searchParams;
  const { client } = await requireClient(clientSlug);
  const seoContext = await seoContextForClient(client.id);
  const plannedFor = parseDay(date);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">New post</h1>
      <PostForm
        clientId={client.id}
        clientSlug={clientSlug}
        post={null}
        seoContext={seoContext}
        defaultPlannedFor={plannedFor}
      />
    </div>
  );
}
