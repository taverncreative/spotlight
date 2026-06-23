import Link from "next/link";

export type MetaAccount = {
  id: string;
  platform: string;
  display_name: string | null;
};

// "Post to" target selector. When the client has connected Meta accounts they
// render as selectable checkboxes (the Meta-connect slice populates them); until
// then meta_accounts is empty and this is the connect state.
export function SocialTargets({ accounts }: { accounts: MetaAccount[] }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Post to</label>
      {accounts.length === 0 ? (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No Meta accounts connected.{" "}
          <Link
            href="/settings/integrations"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Connect Meta
          </Link>{" "}
          to choose where this posts.
        </div>
      ) : (
        <div className="grid gap-2">
          {accounts.map((account) => (
            <label
              key={account.id}
              className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                name="target"
                value={account.id}
                className="size-4 rounded border-input accent-brand"
              />
              <span>{account.display_name ?? account.platform}</span>
              <span className="text-xs text-muted-foreground capitalize">
                {account.platform}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
