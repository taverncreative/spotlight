import { redirect } from "next/navigation";

// Root path sends straight to the single-operator home, which gates on auth and
// bounces signed-out visitors to /login.
export default function RootPage() {
  redirect("/home");
}
