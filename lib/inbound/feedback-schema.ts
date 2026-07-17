import { z } from "zod";

// The external contract for POST /api/inbound/feedback — what a sender (GEM CRM
// first) is allowed to put in the body. Deliberately its OWN schema, not the
// database-insert shape: the two have different obligations. A sender must not be
// able to set operator_id, status, or source_app (that last comes from the token,
// not the body), and the fields it CAN send are validated to the external
// contract, not to whatever the table happens to allow.
//
// Required: message and request_id. request_id is the idempotency key, so a retry
// resolves to the same row rather than a duplicate; without it a resend would
// double-file, so it is mandatory here even though the column is nullable for
// senders that genuinely have no id.
//
// Optional: client_name, type, client_slug, submitter, link. Optional means
// absent is fine, but present-and-wrong is not — each still has to be a string of
// the right shape and within its length cap, so a number, an object, or an
// oversized value is a 400, not a silently-truncated insert. Unknown keys are
// stripped (zod's default), so a stray source_app in the body is ignored rather
// than rejected.
export const inboundFeedbackSchema = z.object({
  message: z.string().trim().min(1).max(5000),
  request_id: z.string().trim().min(1).max(128),
  client_name: z.string().trim().min(1).max(200).optional(),
  type: z.enum(["feature", "change", "bug", "question", "other"]).optional(),
  client_slug: z.string().trim().min(1).max(64).optional(),
  submitter: z.string().trim().min(1).max(200).optional(),
  link: z.string().trim().min(1).max(500).optional(),
});

export type InboundFeedback = z.infer<typeof inboundFeedbackSchema>;
