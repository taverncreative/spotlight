-- Storage bucket for social post media (carousel images/videos). Public read;
-- writes are gated by the policies in 0028. Created via migration so db:reset
-- reproduces it. Objects live at social-media/{client_id}/{post_id}/{uuid}.{ext}.
insert into storage.buckets (id, name, public)
values ('social-media', 'social-media', true)
on conflict (id) do nothing;
