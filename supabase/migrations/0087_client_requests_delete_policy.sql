-- A delete policy for client_requests, narrowed to rows that reached no client.
--
-- 0040 deliberately shipped select and update and NOTHING ELSE, with the reason
-- written down: "a request can be moved to 'done' but never removed, so the
-- inbound record of what was asked for is not destructible from the app". That
-- was right, and it is still right for a real request. What it could not do is
-- tell a real request from an automated test row saying "please delete", and
-- roughly half the table had become the latter.
--
-- SO THE NARROWING IS THE POINT. client_id is null means the request reached no
-- client: either nobody has triaged it yet, or it named a client we do not
-- manage. A test row is always in that state. A request that was assigned to a
-- client stays undeletable, which is the original guarantee kept intact for
-- everything it was actually protecting.
--
-- WHAT THIS GIVES UP, stated rather than discovered later: a genuine request
-- that named a client we do not manage is now deletable too. That is the cost of
-- using "unassigned" as the proxy for "disposable", and it was chosen over a
-- SECURITY DEFINER function with its own audit ledger because that is a lot of
-- machinery for a problem that is currently ten rows.
--
-- AND THE HOLE THAT REMAINS, so nobody later reads this as a guarantee it is
-- not. The update policy (0040) is table-wide with no column scoping and
-- authenticated holds the UPDATE grant, so a crafted PostgREST PATCH under the
-- operator's own session could set client_id back to null and then delete. The
-- app offers no unassign and no reassign -- assignRequestToClient refuses an
-- empty client_id, and the assign control renders only on rows that are already
-- unassigned -- so there is no sequence of clicks that reaches it. This
-- preserves 0040's stated intent, which was about the app, and does not claim to
-- be immutability. Closing that gap needs a trigger making assignment one-way,
-- which was considered and rejected: it would make a misfiled request permanent.
--
-- NOTE ON GRANTS: authenticated already holds DELETE on this table. The only
-- thing that has been preventing deletes is the ABSENCE of a policy, because RLS
-- denies by default when none matches. This policy is therefore the single thing
-- standing between the previous state and a deletable row, which is worth
-- knowing before changing it.
create policy client_requests_operator_delete on public.client_requests
  for delete to authenticated
  using (
    operator_id = (select auth.uid())
    and client_id is null
  );
