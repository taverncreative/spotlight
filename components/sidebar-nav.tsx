"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Settings } from "lucide-react";
import { MODULE_REGISTRY } from "@/lib/modules";
import { cn } from "@/lib/utils";

// The sidebar navigation. Overview routes to the workspace home (the
// dashboard); the Modules nav below it renders an item for each module that is
// built and enabled for this organisation (the enabled keys come from the
// server layout's entitlement query). A Settings nav follows for a client_admin
// only (canManageSettings, settings.manage). Active state is in the brand accent.
const linkClass = (active: boolean) =>
  cn(
    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
    active
      ? "bg-brand/10 font-medium text-brand"
      : "text-muted-foreground hover:bg-accent hover:text-foreground"
  );

export function SidebarNav({
  orgSlug,
  enabledModules,
  canManageSettings,
}: {
  orgSlug: string;
  enabledModules: string[];
  canManageSettings: boolean;
}) {
  const pathname = usePathname();
  const items = MODULE_REGISTRY.filter(
    (entry) => entry.built && enabledModules.includes(entry.key)
  );

  // The workspace home. Overview is active only on an exact match: every module
  // path begins with the home path, so a prefix match would keep it lit always.
  const home = `/app/${orgSlug}`;
  const overviewActive = pathname === home;
  const settingsHref = `/app/${orgSlug}/settings/branding`;
  const settingsActive = pathname.startsWith(`/app/${orgSlug}/settings`);

  return (
    <div className="flex flex-col gap-1">
      <nav aria-label="Workspace" className="flex flex-col gap-1">
        <Link
          href={home}
          aria-current={overviewActive ? "page" : undefined}
          className={linkClass(overviewActive)}
        >
          <LayoutDashboard className="size-4" aria-hidden="true" />
          Overview
        </Link>
      </nav>
      <nav aria-label="Modules" className="flex flex-col gap-1">
        {items.map((entry) => {
          const href = `/app/${orgSlug}/${entry.segment}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const Icon = entry.icon;
          return (
            <Link
              key={entry.key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={linkClass(active)}
            >
              <Icon className="size-4" aria-hidden="true" />
              {entry.label}
            </Link>
          );
        })}
      </nav>
      {canManageSettings ? (
        <nav aria-label="Settings" className="flex flex-col gap-1">
          <Link
            href={settingsHref}
            aria-current={settingsActive ? "page" : undefined}
            className={linkClass(settingsActive)}
          >
            <Settings className="size-4" aria-hidden="true" />
            Settings
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
