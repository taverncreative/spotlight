import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeHtml } from "@/lib/posts/paste-html";

// parseHtmlToBody needs a DOM and is covered in the browser; the decision that
// actually needs pinning is this one, because it is where a false positive eats
// somebody's prose.

test("real markup is recognised, tag by tag", () => {
  for (const html of [
    "<h2>Boiler servicing</h2>",
    "<p>A <strong>full</strong> service.</p>",
    '<a href="https://example.co.uk">link</a>',
    "<ul><li>Flue</li></ul>",
    "<br>",
    "<img src='x.png' />",
    '<div class="wrap">\n  <p>indented</p>\n</div>',
  ]) {
    assert.equal(looksLikeHtml(html), true, html);
  }
});

test("prose that merely contains angle brackets is left alone", () => {
  for (const text of [
    "Prices under < 10 are rare",
    "if x < 10 and y > 2 then",
    "5 < 10",
    "a <> b",
    "an unfinished < tag",
    "plain text with no brackets at all",
    "",
  ]) {
    assert.equal(looksLikeHtml(text), false, JSON.stringify(text));
  }
});

test("an autolink-style URL in angle brackets is not markup", () => {
  // The character after the tag name is a colon, so this must not match. It is
  // the case a naive /<[a-z]/ test gets wrong.
  assert.equal(looksLikeHtml("<https://example.co.uk>"), false);
  assert.equal(looksLikeHtml("<mailto:john@example.co.uk>"), false);
});

test("markdown is not mistaken for markup", () => {
  for (const md of [
    "## Boiler servicing",
    "- Flue\n- Pressure",
    "A **full** service with a [link](https://example.co.uk).",
    "> quoted",
  ]) {
    assert.equal(looksLikeHtml(md), false, md);
  }
});
