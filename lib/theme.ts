import { cookies } from "next/headers";

// Theme handling (Design Pass 1). Dark is the default. The chosen theme is held
// in a cookie so the server can render the right theme on the first paint (no
// flash of the wrong theme) and it persists across sessions on that browser.
// The toggle in the app header writes the cookie and flips the class live.
//
// Persistence is per browser, not per user account; moving it to a per-user
// column is a small later change if the workspace ever needs it to follow a
// user across devices.

export type Theme = "dark" | "light";

export const THEME_COOKIE = "theme";
export const DEFAULT_THEME: Theme = "dark";

// Read the theme from the request cookies, defaulting to dark when unset or
// unrecognised. Called from the root layout to set the class on <html>, and
// from the workspace layout to seed the toggle so server and client agree.
export async function getTheme(): Promise<Theme> {
  const store = await cookies();
  return store.get(THEME_COOKIE)?.value === "light" ? "light" : DEFAULT_THEME;
}
