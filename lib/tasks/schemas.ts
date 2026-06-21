import { z } from "zod";

// Tasks schemas (Pass 6B). Empty optional fields normalise to null at the
// schema boundary, the same pattern as leads, customers and sites: one
// representation for "no value", and absent fields stay undefined (meaning
// "do not change" on update). The polymorphic link (related_type/related_id)
// is validated here for shape only (both set or both null); that the record
// actually exists in the organisation is an application-layer check in the
// actions, standing in for the absent foreign key.

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export const RELATED_TYPES = ["lead", "customer", "site", "quote"] as const;

const optionalText = z.preprocess(
  emptyToNull,
  z.string().trim().max(2000).nullish()
);

// due_at accepts an ISO datetime (Date.toISOString and offsets), empty -> null.
const optionalDueAt = z.preprocess(
  emptyToNull,
  z.iso.datetime({ offset: true }).nullish()
);

const optionalAssignee = z.preprocess(emptyToNull, z.uuid().nullish());
const optionalRelatedType = z.preprocess(
  emptyToNull,
  z.enum(RELATED_TYPES).nullish()
);
const optionalRelatedId = z.preprocess(emptyToNull, z.uuid().nullish());

// The pair must move together: both given or both absent, and when given,
// both null or both set. undefined means "not provided" (untouched on update);
// null means "explicitly cleared".
function relatedPairValid(v: {
  related_type?: string | null;
  related_id?: string | null;
}) {
  const typeGiven = v.related_type !== undefined;
  const idGiven = v.related_id !== undefined;
  if (typeGiven !== idGiven) return false;
  if (!typeGiven) return true;
  return (v.related_type === null) === (v.related_id === null);
}

const relatedPairMessage =
  "related_type and related_id must be set together (or both cleared)";

export const taskCreateSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    description: optionalText,
    due_at: optionalDueAt,
    assigned_to: optionalAssignee,
    // status is optional on create (the create form offers it); absent leaves
    // the database default of 'open'.
    status: z.enum(TASK_STATUSES).optional(),
    related_type: optionalRelatedType,
    related_id: optionalRelatedId,
  })
  .refine(relatedPairValid, {
    message: relatedPairMessage,
    path: ["related_id"],
  });

export const taskUpdateSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1, "Title is required").max(200).optional(),
    description: optionalText,
    due_at: optionalDueAt,
    assigned_to: optionalAssignee,
    related_type: optionalRelatedType,
    related_id: optionalRelatedId,
  })
  .refine(relatedPairValid, {
    message: relatedPairMessage,
    path: ["related_id"],
  });

export const taskStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(TASK_STATUSES),
});

export const taskIdSchema = z.object({ id: z.uuid() });

// List filters: by status, by assignee, an overdue flag, and an optional
// related_type+related_id to fetch one record's tasks (both together).
export const taskListSchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    assigned_to: z.uuid().optional(),
    overdue: z.boolean().optional(),
    related_type: z.enum(RELATED_TYPES).optional(),
    related_id: z.uuid().optional(),
  })
  .refine(
    (v) => (v.related_type === undefined) === (v.related_id === undefined),
    {
      message: "related_type and related_id must be given together to filter",
      path: ["related_id"],
    }
  );
