-- Bucket de mídia: público (a Meta precisa baixar a imagem por URL pública).
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- Leitura pública (bucket público) já permite GET das URLs.
-- Escrita/gestão: cada usuário só mexe na própria pasta {auth.uid()}/...
create policy "media upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "media update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "media delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
