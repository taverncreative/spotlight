"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Shared sign-out: end the Supabase session and return to /login. Used by the
// home, client (/c) and settings layouts.
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
