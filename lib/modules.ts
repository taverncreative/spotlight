import {
  Inbox,
  Users,
  FileText,
  ListChecks,
  Folder,
  LayoutTemplate,
  Zap,
  PiggyBank,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";

// The module registry: the TypeScript counterpart of the module_key domain
// in migration 0004. Each entry maps a module key to its navigation label,
// icon and route segment, and says whether the module is built yet. The
// sidebar shows an item only when the module is both built and enabled for
// the organisation (an entitlement row exists). New modules add themselves
// here; adding a module key means updating the SQL domain and this registry
// together.
export type ModuleEntry = {
  key: string;
  label: string;
  segment: string;
  icon: LucideIcon;
  built: boolean;
};

export const MODULE_REGISTRY: ModuleEntry[] = [
  { key: "leads", label: "Leads", segment: "leads", icon: Inbox, built: true },
  {
    key: "customers",
    label: "Customers",
    segment: "customers",
    icon: Users,
    built: true,
  },
  {
    key: "quotes",
    label: "Quotes",
    segment: "quotes",
    icon: FileText,
    built: true,
  },
  {
    key: "tasks",
    label: "Tasks",
    segment: "tasks",
    icon: ListChecks,
    built: true,
  },
  {
    key: "jobs",
    label: "Jobs",
    segment: "jobs",
    icon: CalendarClock,
    built: true,
  },
  {
    key: "files",
    label: "Files",
    segment: "files",
    icon: Folder,
    built: false,
  },
  {
    key: "templates",
    label: "Templates",
    segment: "templates",
    icon: LayoutTemplate,
    built: true,
  },
  {
    key: "automations",
    label: "Automations",
    segment: "automations",
    icon: Zap,
    built: true,
  },
  {
    key: "subscription_savings",
    label: "Savings",
    segment: "savings",
    icon: PiggyBank,
    built: true,
  },
];
