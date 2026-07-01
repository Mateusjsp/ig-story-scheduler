-- Style presets: estilos de caption salvos por usuário (cor, fonte, scrim,
-- contorno, posição, tamanho). O painel resolve o preset escolhido pra um JSON
-- e manda pro image-service no /process — o serviço continua stateless.
-- `config` guarda o mesmo schema do StyleConfig (image-service/app/imaging/style.py).

create table style_presets (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  config     jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index style_presets_owner_idx on style_presets(owner);
-- no máximo um preset default por usuário
create unique index style_presets_one_default_idx on style_presets(owner)
  where is_default;
create trigger style_presets_updated before update on style_presets
  for each row execute function set_updated_at();

-- ───────────────────────── RLS ─────────────────────────
alter table style_presets enable row level security;
create policy "style_presets owner" on style_presets
  for all using (owner = auth.uid()) with check (owner = auth.uid());
