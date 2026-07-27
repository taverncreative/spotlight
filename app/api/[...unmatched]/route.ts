import { NextResponse } from "next/server";

// Every unmatched path under /api, answered with a real 404 as JSON.
//
// WHY THIS EXISTS. Without it, a POST to a path that matches no route fell
// through to Next's not-found rendering and came back as **HTTP 200 with an HTML
// 404 page**. GET was fine (a correct 404); POST and PUT were not. That is the
// exact shape of bug that hides an integration failure forever, because every
// sender checks the status and no sender POSTs expecting HTML:
//
//   * GEM posted print orders to /api/inbound/print-order for as long as that
//     route did not exist, got 200 every time, recorded each one as delivered,
//     and never wrote a delivery_reason. The orders were never anywhere. It took
//     a manual probe to find, because nothing on either side reported a failure.
//
// A typo in a path, a renamed route, or an endpoint that was specced but never
// deployed all read as SUCCESS to the caller under that behaviour. A route
// handler is the fix rather than a not-found page because a handler owns its own
// status code for every method, where the not-found path does not.
//
// Route precedence makes this safe: static and dynamic segments both beat a
// catch-all, so every real route above still wins and only genuinely unmatched
// paths land here. Adding a route never requires touching this file.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same opaque shape the inbound endpoints use for their own rejections, so a
// sender parses one error format across the whole API surface.
function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// Every method spelled out. Next only routes the methods a handler exports, so
// an unexported one would fall back to the 200-rendering path this file exists
// to close. HEAD must return no body, per the spec.
export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
export function HEAD() {
  return new NextResponse(null, { status: 404 });
}
