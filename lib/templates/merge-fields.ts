// The merge-field catalogue (Pass 9A): the single source of truth for the
// placeholder tokens a template author may use, and what each represents. A
// later UI reads this to show the author which tokens exist; the fill engine
// itself fills whatever context it is handed and does not depend on this list,
// so a token absent here simply renders empty rather than being rejected.
//
// A value is supplied at fill time by whatever builds the context from a
// record's data (a later pass wires the contexts); this list names the tokens,
// documents them, and carries one sample value each. The sample is the single
// source for the live preview on the templates screen, so author-facing preview
// data never drifts from the catalogue.

export type MergeField = {
  token: string;
  label: string;
  description: string;
  sample: string;
};

export const MERGE_FIELDS: MergeField[] = [
  {
    token: "contact_name",
    label: "Contact name",
    description: "The primary contact's name on the record.",
    sample: "Dave Hughes",
  },
  {
    token: "business_name",
    label: "Business name",
    description: "The customer or lead business name.",
    sample: "Harbour Marine Engineering Ltd",
  },
  {
    token: "organisation_name",
    label: "Workspace name",
    description: "The sending organisation's name.",
    sample: "Kestrel Lifting Services",
  },
  {
    token: "quote_number",
    label: "Quote number",
    description: "The quote's reference number.",
    sample: "1042",
  },
  {
    token: "quote_total",
    label: "Quote total",
    description: "The quote's total, formatted as a money amount.",
    sample: "£1,200.00",
  },
  {
    token: "quote_link",
    label: "Quote link",
    description: "The public link a customer uses to view the quote.",
    sample: "https://bskview.example/q/abc123",
  },
  {
    token: "valid_until",
    label: "Quote valid until",
    description: "The date the quote is valid until.",
    sample: "31 July 2026",
  },
];

// The bare token names, for example for validating or listing in a UI.
export const MERGE_FIELD_TOKENS = MERGE_FIELDS.map((field) => field.token);

// The token-to-sample map, for filling a live preview from the catalogue alone.
export const SAMPLE_CONTEXT: Record<string, string> = Object.fromEntries(
  MERGE_FIELDS.map((field) => [field.token, field.sample])
);
