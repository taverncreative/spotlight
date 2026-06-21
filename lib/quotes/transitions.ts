// The quote status flow, defined once. draft goes to sent (stamping
// issued_at); sent resolves to accepted, declined or expired, or returns to
// draft as mistake recovery (clearing issued_at). Accepted, declined and
// expired are terminal: reopening them is a deliberate future decision, not
// built yet (see CLAUDE.md).
export const QUOTE_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["sent"],
  sent: ["accepted", "declined", "expired", "draft"],
  accepted: [],
  declined: [],
  expired: [],
};

export const TRANSITION_AUDIT_ACTIONS: Record<string, string> = {
  sent: "quote.sent",
  accepted: "quote.accepted",
  declined: "quote.declined",
  expired: "quote.expired",
  draft: "quote.returned_to_draft",
};
