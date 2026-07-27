import { z } from "zod";

// The external contract for POST /api/inbound/print-order — what a sender (GEM's
// print library first) is allowed to put in the body. Its OWN schema, not the
// database-insert shape, for the same reason feedback's is: a sender must not be
// able to set operator_id, status, or source_app (that last comes from the token,
// not the body), and the fields it CAN send are validated to the external
// contract rather than to whatever the tables happen to allow.
//
// Required: order_id and items. order_id is the idempotency key, so a retry
// resolves to the same row rather than a duplicate — and here a duplicate is a
// duplicate physical print run, not just a duplicate list entry, which is why it
// is mandatory on the wire even though the column is nullable for senders that
// genuinely have no id.
//
// Optional: client_name, client_slug, submitter, ordered_at. Optional means
// absent is fine, but present-and-wrong is not — each still has to be the right
// shape and within its cap, so a number, an object, or an oversized value is a
// 400, not a silently-truncated insert. Unknown keys are stripped (zod's
// default), so a stray source_app in the body is ignored rather than rejected.
//
// client_slug is the attribution seam. GEM does not send it yet, so orders land
// reading as the source app; the moment GEM starts sending it, the same orders
// link to the real client with no change at this end. That is why it is optional
// rather than required: requiring it would have meant no orders at all until
// both sides shipped together.

// Caps mirror the table's check constraints exactly (0057). Stated in both
// places on purpose: the table is the backstop nothing can forget, this is the
// one that can name the offending field back to the sender so they can fix their
// integration.
const printOrderItemSchema = z.object({
  name: z.string().trim().min(1).max(300),
  quantity: z.number().int().min(1).max(10000),
  reference: z.string().trim().min(1).max(300).optional(),
});

export const inboundPrintOrderSchema = z.object({
  order_id: z.string().trim().min(1).max(128),
  // An order with no lines is not an order. The upper bound is a sanity cap on a
  // public write path, well above any real print run John would take.
  items: z.array(printOrderItemSchema).min(1).max(50),
  client_name: z.string().trim().min(1).max(200).optional(),
  client_slug: z.string().trim().min(1).max(64).optional(),
  submitter: z.string().trim().min(1).max(200).optional(),
  // ISO 8601 with an offset, so "when it was ordered" is an unambiguous instant
  // rather than a local time we would have to guess a zone for.
  ordered_at: z.iso.datetime({ offset: true }).optional(),
});

export type InboundPrintOrder = z.infer<typeof inboundPrintOrderSchema>;
