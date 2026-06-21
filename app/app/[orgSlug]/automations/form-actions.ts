"use server";

import { revalidatePath } from "next/cache";
import { formStateFromError, type FormState } from "@/lib/form-state";
import { getAutomation } from "@/lib/automations/catalogue";
import { setAutomationEnabled, updateAutomationConfig } from "./actions";

// Form-facing wrappers around the automations config actions for the management
// screen (Pass 10C). The actions are reused unchanged; these adapt their throws
// and calm nulls into form state for useActionState, and revalidate the screen so
// the new state and settings show in place.

const automationsPath = (orgSlug: string) => `/app/${orgSlug}/automations`;

export async function setAutomationEnabledFormAction(
  orgSlug: string,
  automationType: string,
  enabled: boolean,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  try {
    const updated = await setAutomationEnabled(orgSlug, {
      automation_type: automationType,
      enabled,
    });
    // A non-runnable type cannot be enabled (the screen never offers its toggle).
    if (!updated) return { formError: "This automation cannot be enabled yet." };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(automationsPath(orgSlug));
  return null;
}

export async function updateAutomationConfigFormAction(
  orgSlug: string,
  automationType: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const type = getAutomation(automationType);
  if (!type) return { formError: "Unknown automation." };

  // Build the config from the form, coercing each value to the kind the action's
  // schema expects (a form sends strings): an integer becomes a number, a member
  // becomes a uuid or null, text stays text. Validation itself stays in the
  // action.
  const config: Record<string, unknown> = {};
  for (const option of type.options) {
    const raw = formData.get(option.key);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (option.kind === "integer") {
      config[option.key] = value === "" ? undefined : Number(value);
    } else if (option.kind === "member") {
      config[option.key] = value === "" ? null : value;
    } else {
      config[option.key] = value;
    }
  }

  try {
    const updated = await updateAutomationConfig(orgSlug, {
      automation_type: automationType,
      config,
    });
    // A calm null means a chosen assignee is not (or is no longer) a member.
    if (!updated) {
      return {
        formError: "That assignee is not a member of this workspace.",
      };
    }
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(automationsPath(orgSlug));
  return null;
}
