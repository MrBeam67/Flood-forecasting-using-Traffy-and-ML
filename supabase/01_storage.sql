-- Run once in Supabase Dashboard -> SQL Editor (safe to re-run).
-- Creates the public bucket for report photos. The backend uploads with the secret
-- (service_role) key; browsers only read via the public URL.
-- Images are re-encoded by the backend to JPEG <= 1280 px, so 2 MB is plenty.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flood-images', 'flood-images', true, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
