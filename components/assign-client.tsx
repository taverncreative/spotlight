import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";

// The assign control for an inbound row that belongs to no client.
//
// A plain form with a server action, not a client component: a select and a
// submit need no JavaScript of their own, and this renders inside the requests
// and print-order lists which are server components.
//
// Shown only on unassigned rows. The action is passed in rather than imported,
// because the two lists write to different tables and the only difference
// between them is which action runs.
export type AssignableClient = { id: string; name: string };

export function AssignClient({
  id,
  clients,
  action,
  label = "Assign to client",
}: {
  id: string;
  clients: AssignableClient[];
  action: (formData: FormData) => void | Promise<void>;
  label?: string;
}) {
  if (clients.length === 0) return null;

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`assign-${id}`} className="sr-only">
        {label}
      </label>
      <select
        id={`assign-${id}`}
        name="client_id"
        defaultValue=""
        required
        className={`${fieldInputClass} h-8 w-auto py-0 text-xs`}
      >
        <option value="" disabled>
          {label}
        </option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="sm">
        Assign
      </Button>
    </form>
  );
}
