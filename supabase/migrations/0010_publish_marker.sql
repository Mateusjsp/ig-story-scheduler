-- Invariante de idempotência: um post com ig_media_id preenchido JÁ SAIU na
-- Meta e nunca deve voltar pra 'queued'. O scheduler curto-circuita nele.
comment on column posts.ig_media_id is
  'ID da mídia publicada na Meta. Preenchido = já publicado (nunca reenfileirar).';

-- Cobre a consulta do claim (0003) e do pg_cron (0005): status + scheduled_at,
-- ambas rodam a cada minuto.
create index if not exists idx_posts_status_sched
  on posts (status, scheduled_at);
