import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// The auth gate for operator-level shells, memoised per request.
//
// getUser() is not a cookie read: it makes a live call to the auth server every
// time. A page whose layout and body each called it paid two round-trips for one
// render, and the /time board was paying three per button press (the proxy's
// refresh, the action's own gate, then the layout again on the revalidated
// re-render).
//
// cache() collapses everything inside ONE request to a single call, the same way
// requireClient does for per-client pages. It cannot help across requests, so
// the proxy's refresh and a server action's own gate remain separate and must:
// an action is a public POST endpoint in its own right and cannot inherit a
// check that ran on a different request. Two per action is the floor without
// weakening that gate; this removes the third.
export const requireUser = cache(async (): Promise<User> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
});
