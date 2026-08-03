-- 'archived' joins the request lifecycle: dealt with, and worth referring back
-- to, which is neither 'done' nor deleted.
--
-- A FOURTH STATUS, NOT A SEPARATE archived_at COLUMN, and the difference matters
-- more than it looks. A timestamp column would let a request be both 'done' and
-- archived at once, and then every list, tab and count has to decide what that
-- combination means -- which is a decision taken separately in each place and
-- therefore taken differently. Archive is where something goes AFTER done, so it
-- belongs on the same axis.
--
-- The trade, stated: a status can hold only one value, so archiving loses the
-- fact that it was 'done' first. That is acceptable because 'archived' already
-- implies it was dealt with; nobody archives an open request they have not
-- looked at.
--
-- Nothing existing moves. Every current row is new/in_progress/done and stays
-- exactly as it is; this only widens what the column will accept.
--
-- The inbound intake function (create_client_request, 0041) only ever writes
-- 'new', so no sender can put a request straight into the archive.
alter table public.client_requests
  drop constraint client_requests_status_check;

alter table public.client_requests
  add constraint client_requests_status_check
    check (status in ('new', 'in_progress', 'done', 'archived'));

-- NO POLICY CHANGE. client_requests_operator_update (0040) is table-wide, so
-- moving a row into or out of the archive is already covered.
--
-- NOTE ON DELETE: 0087 allows deleting only where client_id is null, and that is
-- unchanged by this. An archived request assigned to a client remains
-- undeletable, which is the point -- archive is for the ones worth keeping.
