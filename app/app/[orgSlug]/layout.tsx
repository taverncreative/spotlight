import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SidebarNav } from "@/components/sidebar-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { hasPermission } from "@/lib/authorisation";
import { resolveBrandColor } from "@/lib/brand";
import { getTheme } from "@/lib/theme";
import { signOut } from "./actions";

// The workspace application frame: gate first, then the sidebar, top bar and
// content region. This layout is the template every module screen sits in, and
// the design system's reference shell. The workspace's brand colour is applied
// here as --brand so the accent (active navigation, primary buttons, key
// highlights, focus rings) re-themes per workspace.
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { user, organisation, membership } = await requireWorkspaceAccess(orgSlug);
  const theme = await getTheme();
  const brandColor = resolveBrandColor(organisation.brand_color);
  const canManageSettings = hasPermission(membership, "settings.manage");

  const supabase = await createClient();
  const { data: entitlements } = await supabase
    .from("organisation_entitlements")
    .select("module")
    .eq("organisation_id", organisation.id);
  const enabledModules = (entitlements ?? []).map((row) => row.module);

  // The workspace initial: a calm stand-in for a logo until per-workspace logos
  // land. It uses the workspace brand colour.
  const initial = organisation.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div
      className="flex min-h-screen"
      style={
        {
          // The workspace brand colour drives every accent. It is applied to all
          // the brand-derived tokens here, on the shell, rather than only to
          // --brand: a var() inside a custom property is substituted using the
          // value on the element where the property is declared, so the
          // :root-level --primary: var(--brand) would otherwise stay the default.
          // Setting the tokens directly on the shell re-themes primary buttons,
          // badges, active navigation, focus rings and the brand mark together.
          "--brand": brandColor,
          "--primary": brandColor,
          "--ring": brandColor,
          "--sidebar-primary": brandColor,
          "--sidebar-ring": brandColor,
        } as React.CSSProperties
      }
    >
      <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <Link
          href={`/app/${orgSlug}`}
          className="flex items-center gap-2.5 px-4 py-4 transition-colors hover:bg-sidebar-accent"
        >
          {organisation.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={organisation.logo_url}
              alt=""
              className="size-8 shrink-0 rounded-lg object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-medium text-brand-foreground"
            >
              {initial}
            </span>
          )}
          <p className="truncate text-sm font-medium">{organisation.name}</p>
        </Link>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <SidebarNav
            orgSlug={orgSlug}
            enabledModules={enabledModules}
            canManageSettings={canManageSettings}
          />
        </div>
        <div className="border-t border-sidebar-border px-4 py-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Powered by
            <Wordmark
              className="gap-1.5 [&>span:first-child]:size-4 [&>span:first-child]:rounded [&>span:first-child]:text-[0.6rem]"
              textClassName="text-xs text-foreground"
            />
          </span>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-3 border-b px-6">
          <ThemeToggle initialTheme={theme} />
          <span className="truncate text-sm text-muted-foreground">
            {user.email}
          </span>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </header>
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
