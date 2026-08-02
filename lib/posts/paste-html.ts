// Deciding whether a lump of pasted plain text is really HTML.
//
// WHY THIS EXISTS. Pasting from a rendered web page puts text/html on the
// clipboard and Tiptap converts it correctly with no help from us. Pasting HTML
// SOURCE - out of an email, a CMS export, an AI answer - puts only text/plain on
// the clipboard, and text/plain is text, so ProseMirror inserts the angle
// brackets verbatim. That is correct by the spec and useless in a blog editor.
//
// The test has to be strict in both directions. Too loose and prose about
// inequalities ("if x < 10 and y > 2") gets eaten as markup. Too tight and the
// paste it exists for falls through.

// A plausible HTML tag: a name that starts with a letter, then an optional
// attribute run that cannot contain another angle bracket. Deliberately does
// NOT match "<https://example.com>", where the character after the name is a
// colon, nor "a < b" where no name follows.
const TAG = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/i;

// Cheap pre-check before touching the DOM. Callers still confirm by parsing,
// because a string can look taggish and produce no elements at all.
export function looksLikeHtml(text: string): boolean {
  return TAG.test(text);
}

// Parse into a document that is NOT the live one: nothing here is connected to
// the page, so no script runs and no layout is touched. This is the same thing
// ProseMirror does internally for a text/html paste, so it grants the pasted
// markup no capability it would not already have had.
//
// Returns null when the text produces no element at all, which is the honest
// answer for prose that merely contains an angle bracket.
export function parseHtmlToBody(text: string): HTMLElement | null {
  if (!looksLikeHtml(text)) return null;

  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = text;

  const hasElement = Array.from(doc.body.childNodes).some(
    (node) => node.nodeType === Node.ELEMENT_NODE
  );
  return hasElement ? doc.body : null;
}
