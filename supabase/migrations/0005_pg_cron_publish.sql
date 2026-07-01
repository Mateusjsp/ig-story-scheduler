-- Relógio externo de publicação via pg_cron + pg_net.
--
-- Motivo: o publicador (APScheduler) vive dentro do image-service. Em hosts que
-- hibernam (ex.: Render free), o processo dorme e o polling de 1 min para. Aqui
-- o Postgres (sempre-ligado) checa a fila a cada minuto e, SÓ quando há post
-- vencido (ou vencendo no próximo minuto), faz um POST em /run-due — o que
-- ACORDA o serviço e dispara a publicação. Nenhum post na fila = nenhum wake.
--
-- Publicação dupla não acontece: claim_due_posts (migration 0003) reivindica
-- cada post atomicamente (FOR UPDATE SKIP LOCKED).
--
-- ┌─ SECRETS ────────────────────────────────────────────────────────────────┐
-- │ A URL do endpoint e o token compartilhado NÃO ficam neste arquivo (git).  │
-- │ Grave-os no Vault do Supabase UMA vez (SQL editor):                       │
-- │                                                                           │
-- │   select vault.create_secret(                                            │
-- │     'https://SEU-SERVICE.onrender.com/run-due', 'image_service_url');     │
-- │   select vault.create_secret(                                            │
-- │     'SEU_SERVICE_SHARED_SECRET', 'image_service_token');                  │
-- │                                                                           │
-- │ (mesmo SERVICE_SHARED_SECRET do image-service e do web.)                  │
-- └───────────────────────────────────────────────────────────────────────────┘

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Checa a fila e, havendo post vencido/vencendo, chama /run-due.
create or replace function public.trigger_due_publish()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url   text;
  v_token text;
  v_due   int;
begin
  -- Antecipa 1 min pra cobrir o cold start do host que hiberna.
  select count(*)
    into v_due
    from posts
   where status = 'queued'
     and scheduled_at <= now() + interval '1 minute';

  if v_due = 0 then
    return;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'image_service_url';
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'image_service_token';

  if v_url is null or v_token is null then
    raise warning 'trigger_due_publish: image_service_url/token ausentes no Vault';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'X-Service-Token', v_token
               ),
    body    := '{}'::jsonb,
    -- generoso: cobre o cold start; a publicação real roda em background no serviço.
    timeout_milliseconds := 30000
  );
end $$;

-- Agenda a cada minuto (idempotente por nome do job).
select cron.schedule(
  'publish-due',
  '* * * * *',
  $$select public.trigger_due_publish()$$
);
