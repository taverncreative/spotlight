// The template fill engine (Pass 9A): a pure helper that substitutes
// {{placeholder}} tokens in a template's subject and body from a context map of
// token to value. It is plain text in and plain text out, with no dependency on
// the database or the merge-field catalogue, so it is trivial to test and reuse.
//
// Safety contract:
//   - A placeholder is {{ token }} where token is letters, digits or
//     underscore, with optional surrounding whitespace. Nothing else is treated
//     as a placeholder, so ordinary braces in the text are left untouched.
//   - A token that is missing from the context, or present but null/undefined,
//     renders as the empty string. The raw {{token}} is never left in the
//     output for a recognised placeholder, and a missing token never throws.
//   - Substitution is a single left-to-right pass over the original text using a
//     replacer FUNCTION, so a value is inserted literally: it is never re-scanned
//     for further placeholders (no recursion) and `$` sequences in a value are
//     not interpreted (no $1/$& injection). A value containing "{{...}}" or any
//     other characters therefore cannot inject or break out; it is plain text.

export type FillContext = Record<string, string | null | undefined>;

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function fillText(text: string, context: FillContext): string {
  return text.replace(PLACEHOLDER, (_match, token: string) => {
    const value = context[token];
    return value == null ? "" : String(value);
  });
}

export function fillTemplate(
  template: { subject: string | null; body: string },
  context: FillContext
): { subject: string; body: string } {
  return {
    subject: fillText(template.subject ?? "", context),
    body: fillText(template.body, context),
  };
}

// The distinct well-formed tokens used in the text, in first-seen order. Uses
// the same PLACEHOLDER grammar as the fill, so the screen's unknown-token
// warning and the substitution can never disagree about what counts as a token.
export function extractTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!tokens.includes(match[1])) tokens.push(match[1]);
  }
  return tokens;
}
