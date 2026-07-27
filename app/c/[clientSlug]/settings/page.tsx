import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { ClientSettingsForm } from "@/components/client-settings-form";
import { decryptToken } from "@/lib/oauth/encryption";

// The per-client Settings module: how we work for this client, as opposed to who
// they are.
//
// The Add/Edit dialog used to carry all of this and had reached eight fields,
// most of which had nothing to do with creating a client. It now keeps only
// name, slug and status, the three things without which there is no row and no
// URL. Everything else lives here, where each setting has room for a sentence
// explaining what it does and what blank means.
//
// deploy_hook_url is read but NEVER passed on: it is AES-256-GCM ciphertext
// (0060), and this page hands a client component only a masked hint.
// A recognisable fragment of the stored hook, decrypted here on the server and
// never sent whole to the browser.
//
// The host plus the last four characters of the path is enough to tell "this is
// the Vercel hook for the right project" from "this is something else", which is
// the only question a hint has to answer. The path is the credential, so four
// trailing characters of a long random string is the most that can be shown
// without starting to give it away.
//
// A decrypt failure is reported rather than hidden: it means the key rotated or
// the value was tampered with, and from the operator's side that looks identical
// to a hook that quietly stopped working.
function hookHint(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try {
    const url = new URL(decryptToken(ciphertext));
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.host} …${path.slice(-4)}`;
  } catch {
    return "saved, but it could not be decrypted";
  }
}

export default async function ClientSettingsPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("blog_base_url, deploy_hook_url, services, logo_url")
    .eq("id", client.id)
    .maybeSingle();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          How Spotlight works for {client.name}. The client&rsquo;s name, slug
          and status are on the roster, not here.
        </p>
      </div>

      <ClientSettingsForm
        clientId={client.id}
        clientSlug={client.slug}
        clientName={client.name}
        blogBaseUrl={(data?.blog_base_url as string | null) ?? null}
        deployHookHint={hookHint(
          (data?.deploy_hook_url as string | null) ?? null
        )}
        services={(data?.services as string[] | null) ?? []}
        logoUrl={(data?.logo_url as string | null) ?? null}
      />
    </div>
  );
}
