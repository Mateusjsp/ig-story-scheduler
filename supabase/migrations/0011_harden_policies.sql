-- Função SECURITY DEFINER não deve ser executável via PostgREST por clientes.
-- Grant default do Postgres dá EXECUTE a PUBLIC; só o cron (dono) precisa dela.
revoke execute on function public.trigger_due_publish() from public, anon, authenticated;

-- Policy de UPDATE sem WITH CHECK deixa renomear objeto pra fora da própria pasta.
drop policy if exists "media update own folder" on storage.objects;
create policy "media update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text
  );
