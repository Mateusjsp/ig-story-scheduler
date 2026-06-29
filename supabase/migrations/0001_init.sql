-- IG Story Scheduler — schema inicial (SaaS multi-tenant)
-- Isolamento por tenant: toda tabela tem `owner uuid` = auth.uid() + RLS.
-- O image-service usa a service role key (bypassa RLS) pra publicar/refresh.

-- ───────────────────────── extensões ─────────────────────────
create extension if not exists "pgcrypto";

-- ───────────────────────── enums ─────────────────────────
create type media_status as enum ('raw', 'processed', 'error');
create type post_status  as enum ('queued', 'publishing', 'published', 'failed');
create type account_status as enum ('active', 'token_expired', 'revoked');

-- ───────────────────────── updated_at helper ─────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────── profiles ─────────────────────────
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- cria profile automaticamente no signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ───────────────────────── ig_accounts ─────────────────────────
create table ig_accounts (
  id                uuid primary key default gen_random_uuid(),
  owner             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ig_user_id        text not null,
  username          text,
  access_token_enc  text,                       -- token cifrado (app-level)
  token_expires_at  timestamptz,
  status            account_status not null default 'active',
  graph_host        text not null default 'https://graph.instagram.com',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (owner, ig_user_id)
);
create index ig_accounts_owner_idx on ig_accounts(owner);
create trigger ig_accounts_updated before update on ig_accounts
  for each row execute function set_updated_at();

-- ───────────────────────── account_settings ─────────────────────────
create table account_settings (
  account_id    uuid primary key references ig_accounts(id) on delete cascade,
  owner         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  timezone      text not null default 'America/Sao_Paulo',
  default_times jsonb not null default '["09:00"]'::jsonb,  -- horários padrão
  updated_at    timestamptz not null default now()
);
create trigger account_settings_updated before update on account_settings
  for each row execute function set_updated_at();

-- ───────────────────────── media ─────────────────────────
create table media (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id     uuid references ig_accounts(id) on delete set null,
  original_path  text,           -- caminho no Storage (original enviado)
  processed_path text,           -- caminho do JPEG tratado (1080x1920)
  processed_url  text,           -- URL pública usada como image_url na publicação
  caption        text,
  status         media_status not null default 'raw',
  width          int,
  height         int,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index media_owner_idx on media(owner);
create index media_account_idx on media(account_id);
create trigger media_updated before update on media
  for each row execute function set_updated_at();

-- ───────────────────────── posts (fila/agenda) ─────────────────────────
create table posts (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id    uuid not null references ig_accounts(id) on delete cascade,
  media_id      uuid not null references media(id) on delete cascade,
  scheduled_at  timestamptz not null,
  status        post_status not null default 'queued',
  ig_media_id   text,
  error         text,
  attempts      int not null default 0,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index posts_owner_idx on posts(owner);
-- usado pelo scheduler: pega os vencidos ainda na fila
create index posts_due_idx on posts(scheduled_at) where status = 'queued';
create trigger posts_updated before update on posts
  for each row execute function set_updated_at();

-- ───────────────────────── RLS ─────────────────────────
alter table profiles         enable row level security;
alter table ig_accounts      enable row level security;
alter table account_settings enable row level security;
alter table media            enable row level security;
alter table posts            enable row level security;

-- profiles: dono vê/edita o próprio
create policy "profiles self" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- demais tabelas: dono = auth.uid()
create policy "ig_accounts owner" on ig_accounts
  for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy "account_settings owner" on account_settings
  for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy "media owner" on media
  for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy "posts owner" on posts
  for all using (owner = auth.uid()) with check (owner = auth.uid());
