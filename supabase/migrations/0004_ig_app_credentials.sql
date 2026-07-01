-- Credenciais do app Meta/Instagram por usuário (BYO app).
-- Cada owner cadastra o próprio App ID + App Secret; o OAuth usa esses valores
-- em vez de variáveis de ambiente globais. Secret cifrado (AES-256-GCM, app-level).

create table ig_app_credentials (
  owner           uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  app_id          text not null,
  app_secret_enc  text not null,          -- cifrado com TOKEN_ENC_KEY
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger ig_app_credentials_updated before update on ig_app_credentials
  for each row execute function set_updated_at();

alter table ig_app_credentials enable row level security;

create policy "ig_app_credentials owner" on ig_app_credentials
  for all using (owner = auth.uid()) with check (owner = auth.uid());
