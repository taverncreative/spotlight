import { ZodError, z } from "zod";
import { AuthorisationError } from "@/lib/authorisation";

// The error-presentation layer for form-facing action calls. Server actions
// throw on denial and invalid input, and return null when a target is
// missing or belongs to another tenant; forms need those as calm messages,
// not crashes. Every module's forms use this shape and helper.

export type FormState = {
  formError?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

export const NO_PERMISSION_MESSAGE = "You do not have permission to do that.";

export function goneMessage(entity: string) {
  return `This ${entity} is no longer available.`;
}

export const GONE_MESSAGE = goneMessage("lead");

// Converts a thrown error into form state. Anything unrecognised is a real
// fault and is rethrown for Next.js error handling.
export function formStateFromError(error: unknown): NonNullable<FormState> {
  if (error instanceof AuthorisationError) {
    return { formError: NO_PERMISSION_MESSAGE };
  }
  if (error instanceof ZodError) {
    return { fieldErrors: z.flattenError(error).fieldErrors };
  }
  throw error;
}
