import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FB_FIELDS,
  IG_FIELDS,
  parseFacebookPost,
  parseInsights,
  parseInstagramMedia,
} from "@/lib/social/insights-fields";

// The response shapes below are REAL, captured from Graph v25.0 against a
// Business Sorted Kent post, not invented from documentation.

// --- Instagram ------------------------------------------------------------

test("Instagram likes and comments come through", () => {
  const insights = parseInstagramMedia({
    id: "18117373705904979",
    like_count: 3,
    comments_count: 2,
  });
  assert.equal(insights.likes, 3);
  assert.equal(insights.comments, 2);
});

test("a genuine zero on Instagram is 0, not null", () => {
  // Meta returned these fields, and they said zero. That is a fact about the
  // post and must not be confused with not knowing.
  const insights = parseInstagramMedia({ like_count: 0, comments_count: 0 });
  assert.equal(insights.likes, 0);
  assert.equal(insights.comments, 0);
});

test("Instagram shares is NULL: the field does not exist on media", () => {
  // Asking for it returns "Tried accessing nonexisting field (shares)".
  assert.equal(parseInstagramMedia({ like_count: 1 }).shares, null);
});

test("a missing Instagram count is null rather than zero", () => {
  const insights = parseInstagramMedia({ id: "x" });
  assert.equal(insights.likes, null);
  assert.equal(insights.comments, null);
});

test("nonsense values do not become numbers", () => {
  const insights = parseInstagramMedia({
    like_count: "12",
    comments_count: -4,
  });
  assert.equal(insights.likes, null, "a string is not a count");
  assert.equal(insights.comments, null, "a negative is not a count");
});

// --- Facebook -------------------------------------------------------------

test("Facebook likes and comments are NULL, because we are not permitted them", () => {
  // pages_read_user_content, which this app does not hold. Null is the whole
  // point: 0 would assert that nobody engaged, which we have not been told.
  const insights = parseFacebookPost({ id: "645944765265768_1221776" });
  assert.equal(insights.likes, null);
  assert.equal(insights.comments, null);
});

test("Facebook shares reads its count when present", () => {
  assert.equal(parseFacebookPost({ shares: { count: 7 } }).shares, 7);
});

test("an ABSENT Facebook shares field means zero, not unknown", () => {
  // Meta omits shares entirely when nobody shared. This is the one place a 0 is
  // correct, and only because the field is one we are allowed to read.
  assert.equal(parseFacebookPost({ id: "x" }).shares, 0);
});

test("a malformed shares object is zero rather than a crash", () => {
  assert.equal(parseFacebookPost({ shares: {} }).shares, 0);
  assert.equal(parseFacebookPost({ shares: { count: "many" } }).shares, 0);
});

// --- the rule -------------------------------------------------------------

test("no parser ever invents a zero for something it was not told", () => {
  // The single most important property here: a permission gap must never be
  // rendered as a client's post performing badly.
  const ig = parseInstagramMedia({});
  const fb = parseFacebookPost({});
  assert.equal(ig.likes, null);
  assert.equal(ig.comments, null);
  assert.equal(fb.likes, null);
  assert.equal(fb.comments, null);
});

test("the raw response is kept, so a future field rename is diagnosable", () => {
  const body = { id: "x", like_count: 5, something_new: true };
  assert.deepEqual(parseInstagramMedia(body).raw, body);
});

// --- dispatch and field lists ---------------------------------------------

test("an unknown platform parses to nothing rather than guessing", () => {
  assert.equal(parseInsights("tiktok", { like_count: 9 }), null);
  assert.equal(parseInsights("instagram", { like_count: 9 })?.likes, 9);
  assert.equal(parseInsights("facebook", { shares: { count: 1 } })?.shares, 1);
});

test("Facebook asks for shares ALONE, which is what makes it work", () => {
  // Adding likes or comments makes the whole request fail with a permission
  // error rather than returning the one field we are allowed.
  assert.match(FB_FIELDS, /shares/);
  assert.doesNotMatch(FB_FIELDS, /like|comment|reaction|insights/);
});

test("Instagram asks for exactly the two counts it can have", () => {
  assert.match(IG_FIELDS, /like_count/);
  assert.match(IG_FIELDS, /comments_count/);
  // Never insights: that needs instagram_manage_insights and App Review.
  assert.doesNotMatch(IG_FIELDS, /insights|reach|impressions/);
});
