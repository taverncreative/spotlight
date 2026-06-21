// The automations catalogue (Phase 10, Pass 10A): the single source of truth for
// the automation types a workspace can switch on and configure. It is pure data
// with no dependency on the database or zod (the config schemas are derived from
// it in lib/automations/schemas.ts), so it is trivial to read, test and show in
// a later UI. Each workspace's on/off and settings live in org_automations,
// keyed by the type's stable `key`.

export type TriggerKind = "event" | "schedule";

export type AutomationActionKind = "create_task" | "send_email";

// The action kinds the engine knows about and whether it can run each today. An
// in-app action (create_task) is runnable now; sending email waits for the email
// and deployment work, so it is known but not yet runnable.
export const ACTION_KINDS: Record<
  AutomationActionKind,
  { label: string; runnable: boolean }
> = {
  create_task: { label: "Create a task", runnable: true },
  send_email: { label: "Send an email", runnable: false },
};

// One configurable setting of an automation. `kind` drives both the later UI
// control and the config validation derived in schemas.ts: text is a string,
// integer a whole number within min/max, member the id of an active workspace
// member (the membership itself is checked in the action, as tasks do).
export type AutomationOption = {
  key: string;
  label: string;
  description: string;
  kind: "text" | "integer" | "member";
  required: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
};

// The machine-readable events the engine can dispatch on. A trigger of kind
// "event" names one of these; the engine matches a fired event to the
// automations whose trigger.event equals it.
export const AUTOMATION_EVENTS = [
  "lead.created",
  "quote.accepted",
  "quote.declined",
] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export type AutomationTrigger = {
  // "event" fires immediately when the event happens; "schedule" runs on a timer
  // (scheduled automations come with the deployment work, so are not yet runnable).
  kind: TriggerKind;
  // For kind "event", the machine-readable event that fires it.
  event?: AutomationEvent;
  description: string;
};

export type AutomationType = {
  key: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  actionKind: AutomationActionKind;
  options: AutomationOption[];
};

// The options every create_task automation shares (Pass 10D): the task title,
// how many days from the trigger the task is due, and an optional assignee. Used
// by all three create_task types so their config shape stays identical and the
// management screen renders them the same way.
const CREATE_TASK_OPTIONS: AutomationOption[] = [
  {
    key: "task_title",
    label: "Task title",
    description: "The title of the task to create.",
    kind: "text",
    required: true,
    maxLength: 200,
  },
  {
    key: "days_until_due",
    label: "Days until due",
    description: "How many days from the trigger the task is due.",
    kind: "integer",
    required: true,
    min: 0,
    max: 365,
  },
  {
    key: "assignee_id",
    label: "Assignee",
    description: "An optional team member to assign the task to.",
    kind: "member",
    required: false,
  },
];

export const AUTOMATIONS: AutomationType[] = [
  {
    key: "lead_followup_task",
    name: "Lead follow-up task",
    description:
      "When a new lead arrives, create a follow-up task linked to that lead so it is always picked up.",
    trigger: { kind: "event", event: "lead.created", description: "A lead is created" },
    actionKind: "create_task",
    options: CREATE_TASK_OPTIONS,
  },
  {
    key: "quote_accepted_task",
    name: "Quote accepted task",
    description:
      "When a quote is accepted, create a task linked to it so the job is prepared and nothing is missed.",
    trigger: {
      kind: "event",
      event: "quote.accepted",
      description: "A quote is accepted",
    },
    actionKind: "create_task",
    options: CREATE_TASK_OPTIONS,
  },
  {
    key: "quote_declined_task",
    name: "Quote declined task",
    description:
      "When a quote is declined, create a task linked to it so you can follow up and learn why.",
    trigger: {
      kind: "event",
      event: "quote.declined",
      description: "A quote is declined",
    },
    actionKind: "create_task",
    options: CREATE_TASK_OPTIONS,
  },
  {
    // Defined so the workspace can see what is coming, but not yet runnable: the
    // send_email action waits for the email work, so isAutomationRunnable returns
    // false and the screen shows it as coming soon and offers no controls. No
    // email action or options are built this pass.
    key: "lead_acknowledgement_email",
    name: "Lead acknowledgement email",
    description:
      "When a new lead arrives, send them an acknowledgement email so they know you have received their enquiry.",
    trigger: { kind: "event", event: "lead.created", description: "A lead is created" },
    actionKind: "send_email",
    options: [],
  },
];

export const AUTOMATION_KEYS = AUTOMATIONS.map((type) => type.key);

export function getAutomation(key: string): AutomationType | undefined {
  return AUTOMATIONS.find((type) => type.key === key);
}

// Whether the engine can run this automation today: a runnable action kind and
// an immediate event trigger. A schedule trigger is not yet runnable even with a
// runnable action, since scheduling comes later.
export function isAutomationRunnable(type: AutomationType): boolean {
  return ACTION_KINDS[type.actionKind].runnable && type.trigger.kind === "event";
}
