-- Storage bucket for blog images (featured and inline). Public read; writes are
-- gated by the policies in 0014. Created via migration so db:reset reproduces it.
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;
