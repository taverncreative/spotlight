import "server-only";
import { createClient } from "@/lib/supabase/server";

// The customers and sites a job form needs: the organisation's active customers,
// and its active sites with their customer so the form can scope the site picker
// to the chosen customer. Read through the user session (RLS scopes to the org);
// the caller has already gated workspace access and the jobs module.
export async function loadJobFormOptions(organisationId: string) {
  const supabase = await createClient();
  const [customers, sites] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name")
      .eq("organisation_id", organisationId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("sites")
      .select("id, name, customer_id")
      .eq("organisation_id", organisationId)
      .is("deleted_at", null)
      .order("name"),
  ]);
  if (customers.error) throw new Error(customers.error.message);
  if (sites.error) throw new Error(sites.error.message);
  return {
    customers: (customers.data ?? []) as { id: string; name: string }[],
    sites: (sites.data ?? []) as {
      id: string;
      name: string;
      customer_id: string;
    }[],
  };
}
