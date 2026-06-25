"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { error: string } | null;

export async function signIn(
  _previous: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // TEMPORARY DIAGNOSTIC: surface the real Supabase auth error so we can tell
    // apart "Invalid login credentials" / "Email not confirmed" / "Invalid API
    // key" in prod. Revert to the generic message once diagnosed.
    return {
      error: `[diag] ${error.message} (status: ${error.status ?? "?"}, code: ${error.code ?? "?"})`,
    };
  }

  redirect("/home");
}
