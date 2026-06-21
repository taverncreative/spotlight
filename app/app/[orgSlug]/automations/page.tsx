import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ListScreen } from "@/components/list-screen";
import { SectionCard } from "@/components/section-card";
import { AutomationToggle } from "@/components/automation-toggle";
import { AutomationConfigForm } from "@/components/automation-config-form";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import { ACTION_KINDS, type AutomationOption } from "@/lib/automations/catalogue";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listOrganisationMembers, type OrganisationMember } from "@/lib/members";
import { listAutomations } from "./actions";
import {
  setAutomationEnabledFormAction,
  updateAutomationConfigFormAction,
} from "./form-actions";

// The Automations management screen (Pass 10C): the workspace's transparency and
// control surface. Every member sees the full catalogue merged with this
// workspace's state, in plain language; only a client_admin gets the enable
// toggle and the settings form. A type that is not yet runnable shows as coming
// soon with no controls.

type Automation = {
  key: string;
  name: string;
  description: string;
  trigger: { kind: string; description: string };
  action_kind: string;
  runnable: boolean;
  options: AutomationOption[];
  enabled: boolean;
  config: Record<string, unknown>;
};

// "A lead is created" -> "When a lead is created".
function triggerSummary(description: string) {
  return `When ${description.charAt(0).toLowerCase()}${description.slice(1)}`;
}

function actionSummary(actionKind: string) {
  return ACTION_KINDS[actionKind as keyof typeof ACTION_KINDS]?.label ?? actionKind;
}

export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canManage = hasPermission(membership, "settings.manage");

  let automations: Automation[];
  try {
    automations = (await listAutomations(orgSlug)) as Automation[];
  } catch (error) {
    // No automations entitlement: send the member back to the workspace overview
    // rather than showing a broken screen. Anything else is a real error.
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  // Members are only needed for the assignee pickers a client_admin sees.
  const members: OrganisationMember[] = canManage
    ? await listOrganisationMembers(orgSlug)
    : [];

  return (
    <ListScreen
      title="Automations"
      description="Every automation your workspace can run. Switch on the ones you want and configure each."
    >
      <ul className="space-y-4">
        {automations.map((automation) => (
          <li key={automation.key}>
            <SectionCard
              title={automation.name}
              action={
                <StateBadge
                  runnable={automation.runnable}
                  enabled={automation.enabled}
                />
              }
            >
              <p className="text-sm text-muted-foreground">
                {automation.description}
              </p>

              <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="font-medium">Trigger</dt>
                  <dd className="text-muted-foreground">
                    {triggerSummary(automation.trigger.description)}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-medium">Action</dt>
                  <dd className="text-muted-foreground">
                    {actionSummary(automation.action_kind)}
                  </dd>
                </div>
              </dl>

              {!automation.runnable ? (
                <p className="text-sm text-muted-foreground">
                  This automation is coming soon and cannot be switched on yet.
                </p>
              ) : canManage ? (
                <div className="space-y-4 border-t pt-4">
                  <AutomationToggle
                    enabled={automation.enabled}
                    action={setAutomationEnabledFormAction.bind(
                      null,
                      orgSlug,
                      automation.key,
                      !automation.enabled
                    )}
                  />
                  {automation.options.length > 0 ? (
                    <AutomationConfigForm
                      idPrefix={automation.key}
                      options={automation.options}
                      config={automation.config}
                      members={members}
                      action={updateAutomationConfigFormAction.bind(
                        null,
                        orgSlug,
                        automation.key
                      )}
                    />
                  ) : null}
                </div>
              ) : null}
            </SectionCard>
          </li>
        ))}
      </ul>
    </ListScreen>
  );
}

function StateBadge({
  runnable,
  enabled,
}: {
  runnable: boolean;
  enabled: boolean;
}) {
  if (!runnable) {
    return <Badge variant="outline">Coming soon</Badge>;
  }
  return enabled ? (
    <Badge>Active</Badge>
  ) : (
    <Badge variant="secondary">Inactive</Badge>
  );
}
