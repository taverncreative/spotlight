import { z } from "zod";

// Zod schemas for the form-management actions. Kept in lib because the
// "use server" actions file may only export async functions.

export const webhookFormCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the form a name.").max(100),
});

export const webhookFormIdSchema = z.object({
  id: z.string().uuid(),
});

export const webhookFormStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "disabled"]),
});
