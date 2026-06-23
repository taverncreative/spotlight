// Pure error model + classification for the publisher. Deliberately free of
// "server-only" and path-aliased imports so it can be unit-tested in isolation
// with fixtures (Slice 20e Stage 1).

export type ErrorClass = "transient" | "auth" | "validation";

// Raised by platform publishers so the engine can route retries. A bare throw
// (e.g. a network error from fetch) is treated as transient by the engine.
export class PublishError extends Error {
  classification: ErrorClass;
  constructor(message: string, classification: ErrorClass) {
    super(message);
    this.name = "PublishError";
    this.classification = classification;
  }
}

// Classify a Meta Graph error into the retry policy.
//   transient  -> retry next tick (network, 5xx, rate limits), capped by attempts
//   auth       -> stop the target, flag the account needs_reconnect (terminal)
//   validation -> terminal with the message, no retry (bad image/aspect ratio…)
// httpStatus null means the request threw before any response (network) -> transient.
export function classifyMetaError(
  httpStatus: number | null,
  body: unknown
): ErrorClass {
  if (httpStatus === null) return "transient";
  const err = (body as { error?: { code?: number; error_subcode?: number } })
    ?.error;
  const code = err?.code;
  const subcode = err?.error_subcode;

  // Auth / token problems.
  const AUTH_CODES = new Set([190, 102, 10, 200, 2500]);
  const AUTH_SUBCODES = new Set([458, 459, 460, 463, 464, 467, 492]);
  if (
    httpStatus === 401 ||
    (code !== undefined && AUTH_CODES.has(code)) ||
    (subcode !== undefined && AUTH_SUBCODES.has(subcode))
  ) {
    return "auth";
  }

  // Transient: server errors, rate limits, temporary/unknown Meta codes.
  const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);
  if (
    httpStatus >= 500 ||
    httpStatus === 429 ||
    (code !== undefined && TRANSIENT_CODES.has(code))
  ) {
    return "transient";
  }

  // Everything else (other 4xx) is a validation/terminal error.
  return "validation";
}
