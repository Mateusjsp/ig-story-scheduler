# Plano 008 — Webhooks de Story (menções + respostas via DM) + App híbrido

## Objetivo
Receber em tempo real quando alguém **menciona a conta num story** ou **responde um
story** publicado — ambos chegam como DM pela Instagram API with Instagram Login (mesmo
login/token que o projeto já usa, `graph.instagram.com`). Persistir por conta
(multi-tenant), mostrar na dashboard. Opcional (fase C): responder o DM na janela de 24h.

Pré-requisito de produto: migrar o modelo de app de **BYO puro** (hoje) para **híbrido**
(app central default + BYO avançado), decidido com o mantenedor.

> **Premissa corrigida**: NÃO precisa Facebook Login nem Graph da Página. O Instagram
> Login já suporta webhooks. Falta (1) scope de mensagens, (2) rota de webhook, (3)
> assinatura do app no field `messages`, (4) App Review da Meta pra produção.

---

## Estado atual (verificado no código)
- OAuth Instagram Login, 2 scopes: `instagram_business_basic`,
  `instagram_business_content_publish` — [start/route.ts:36-39](../web/app/api/instagram/start/route.ts#L36-L39).
- **BYO puro**: cada owner cadastra `app_id` + `app_secret_enc` em `ig_app_credentials`
  (PK por owner) — [0004](../supabase/migrations/0004_ig_app_credentials.sql),
  [credentials-form.tsx](../web/app/dashboard/accounts/connect/credentials-form.tsx). O
  [start/route.ts:23-28](../web/app/api/instagram/start/route.ts#L23-L28) **exige** creds
  (redireciona se faltar).
- Usa o **Instagram app ID/secret** (seção "API setup with Instagram login"), não o app
  Meta do topo — [connect/page.tsx:24-29](../web/app/dashboard/accounts/connect/page.tsx#L24-L29).
- Token longo (60d) cifrado em `ig_accounts.access_token_enc`; refresh diário no
  [scheduler.py:106](../image-service/app/scheduler.py#L106).
- `ig_accounts` tem `ig_user_id` (= `me.user_id`), `graph_host`, `status` enum
  (`active`/`token_expired`/`revoked`) — [0001:42-55](../supabase/migrations/0001_init.sql#L42-L55).
- `image-service/app/settings.py:23-25` já tem env `instagram_app_id` /
  `instagram_app_secret` / `graph_host` **ociosos** — reusáveis pro app central.
- **Nada inbound existe** — fluxo 100% outbound (publicar).

---

## Decisão de produto: modelo HÍBRIDO
- **Default = central**: sem `ig_app_credentials`, a conta conecta via **app central
  nosso** (env). Onboarding de 1 clique.
- **Avançado = BYO**: com `ig_app_credentials`, usa o app do próprio owner (fluxo atual).
- Cada `ig_accounts` grava **qual origem** autenticou, pra refresh e webhook saberem qual
  secret usar.
- Contas já conectadas hoje = todas BYO; migração marca `app_source='byo'` e não quebra.

---

## Modelo de dados

### Migration `0009_app_source.sql` (habilita híbrido)
```sql
create type app_source as enum ('central', 'byo');
alter table ig_accounts add column app_source app_source not null default 'byo';
-- 'byo' como default protege as contas existentes; novas via central gravam 'central'.
```

### Migration `0010_story_events.sql` (webhook)
```sql
create type story_event_type as enum ('story_mention', 'story_reply', 'message');

create table story_events (
  id              uuid primary key default gen_random_uuid(),
  owner           uuid not null references auth.users(id) on delete cascade,
  account_id      uuid references ig_accounts(id) on delete cascade,
  ig_user_id      text not null,             -- conta que recebeu (recipient)
  type            story_event_type not null,
  sender_ig_id    text,
  sender_username text,
  message_text    text,
  attachment_url  text,                       -- CDN do story (expira!)
  raw             jsonb not null,
  mid             text unique,                -- message id Meta (idempotência)
  read_at         timestamptz,
  received_at     timestamptz not null default now()
);
create index story_events_account_idx on story_events(account_id, received_at desc);
alter table story_events enable row level security;
create policy "story_events owner" on story_events
  for all using (owner = auth.uid()) with check (owner = auth.uid());
-- inserts vêm da service role (webhook) => bypassa RLS.
```

Idempotência: `mid unique` + upsert `on conflict do nothing`. Se não achar `ig_accounts`
pelo `recipient.id`, dropa (não é conta nossa).

---

# ┌─────────────────────────────────────────┐
# │  PARTE 1 — O QUE É SEU (manual, você faz) │
# └─────────────────────────────────────────┘

Coisas que **só você** pode fazer (painel Meta, decisões, envs secretos, testes reais).

## S1 — Decisão travada ✅
Modelo **híbrido** já decidido. Nada a fazer, só ciente das consequências (você mantém o
App Review do app central; BYO cada cliente faz o seu).

## S2 — Criar/configurar o App Central na Meta
1. developers.facebook.com → criar app (ou usar um seu já existente) com produto
   **Instagram → API setup with Instagram login**.
2. Copiar **Instagram app ID** + **Instagram app secret** (seção "2. Set up Instagram
   business login") — NÃO o App ID do topo.
3. Liberar redirect OAuth: `{SITE}/api/instagram/callback`.
4. Business verification da Meta (necessária pra publicar + messaging em produção).

## S3 — Configurar o Webhook no painel
1. App Dashboard → **Webhooks** (ou Instagram → Webhooks) → callback URL
   `https://<seu-site>/api/instagram/webhook`, verify token = string que você inventa.
2. Inscrever o field **`messages`**.
3. (Dev) Adicionar contas de teste: Roles → Instagram Testers.

## S4 — App Review (bloqueador externo)
1. Pedir a permissão `instagram_business_manage_messages` (produção). Requer screencast do
   fluxo + descrição de uso. Aprovação = dias/semanas.
2. Contas de teste funcionam **sem** review (dá pra validar tudo em dev antes).

## S5 — Preencher envs (valores secretos — você tem, eu não)
No `web` (produção + `.env.local`):
- `META_CENTRAL_APP_ID` = Instagram app ID do app central.
- `META_CENTRAL_APP_SECRET` = Instagram app secret do app central.
- `META_WEBHOOK_VERIFY_TOKEN` = mesma string do S3.
(Eu crio o `.env.example` com os nomes; você põe os valores reais.)

## S6 — Testar local antes de prod
1. Túnel HTTPS: `cloudflared tunnel --url http://localhost:3000` (ou ngrok).
2. URL do túnel como callback num app de teste + conta de teste.
3. De outra conta, mencionar a conta de teste num story → ver chegar na inbox.

## S7 — Aplicar migrations no Supabase
- Rodar `0009` e `0010` no projeto Supabase (não há projeto live no repo pra eu aplicar).
- Marcar contas antigas: já coberto pelo default `'byo'` da `0009` — nada manual.

## S8 — Comunicar reconexão aos usuários
- Contas já conectadas **não** têm o scope de messaging. Cada usuário precisa **reconectar**
  (refazer OAuth) depois do deploy do scope novo. Você avisa/documenta.

---

# ┌──────────────────────────────────────────┐
# │  PARTE 2 — O QUE É MEU (código, eu faço)   │
# └──────────────────────────────────────────┘

## Fase E0 — Habilitar app híbrido (pré-requisito do webhook)
Deployável sozinho; conserta o onboarding independente do webhook.
- [ ] Migration `0009_app_source.sql` (enum + coluna).
- [ ] `web/lib/meta-app.ts`: helper `resolveApp(owner)` → retorna `{appId, appSecret,
      source}`. Com `ig_app_credentials` → BYO; senão → central (env). Um lugar só decide.
- [ ] [start/route.ts](../web/app/api/instagram/start/route.ts): remover o
      "sem_credenciais" obrigatório; usar `resolveApp`. Add scope
      `instagram_business_manage_messages`.
- [ ] [callback/route.ts](../web/app/api/instagram/callback/route.ts): trocar token via
      `resolveApp`; gravar `app_source` no upsert de `ig_accounts`.
- [ ] UI: tela de conexão passa a ter botão "Conectar (rápido)" [central] + seção
      "avançado: usar meu próprio app" [BYO]. Ajustar
      [connect/page.tsx](../web/app/dashboard/accounts/connect/page.tsx) +
      [credentials-form.tsx](../web/app/dashboard/accounts/connect/credentials-form.tsx).
- [ ] `web/.env.example`: `META_CENTRAL_APP_ID`, `META_CENTRAL_APP_SECRET`.
- [ ] Ajustar `image-service` refresh: `refresh_tokens` usa `graph_host` da conta (já usa);
      OK, mas confirmar que central e BYO refrescam igual (mesmo endpoint `ig_refresh_token`).

## Fase E1 — Webhook: handshake + ingestão (núcleo)
- [ ] Migration `0010_story_events.sql`.
- [ ] `web/app/api/instagram/webhook/route.ts`:
  - `GET`: valida `hub.verify_token` == `META_WEBHOOK_VERIFY_TOKEN` → responde
    `hub.challenge` (texto puro).
  - `POST`: lê **corpo cru** (`await request.text()`), valida `X-Hub-Signature-256` =
    `sha256=HMAC(app_secret, rawBody)`. Secret resolvido pela conta (ver E1 resolver).
    Inválido → `403`.
  - Parseia `entry[].messaging[]`; classifica `story_mention` (attachment) / `story_reply`
    (`reply_to.story`) / `message`. Upsert em `story_events` (service role). Responde
    **`200` rápido** sempre.
- [ ] Resolver de secret no webhook: `recipient.id` (JSON) → `ig_accounts` →
      `app_source`. Central → env secret; BYO → `app_secret_enc` do owner (decifra). Reusa
      `web/lib/crypto`.
- [ ] `web/lib/supabase/service.ts` (se não existir): client service-role pro insert que
      bypassa RLS. (Confirmar se já há um; senão criar.)
- [ ] Subscribe automático da conta no [callback/route.ts](../web/app/api/instagram/callback/route.ts)
      após upsert: `POST {graph_host}/{graph_version}/{ig_user_id}/subscribed_apps` com
      `subscribed_fields=messages` + token.
- [ ] Testes: unit do HMAC + classificador de payload (fixtures de story_mention/reply).

## Fase E2 — UI inbox (por conta)
- [ ] Página `web/app/dashboard/accounts/[id]/mentions/page.tsx` (ou aba): lista
      `story_events`, mais recentes primeiro, com thumb, sender, texto, timestamp. Server
      component, query RLS-safe.
- [ ] Badge de não-lidos (`read_at`), marcar lido ao abrir.
- [ ] (Opcional) Supabase Realtime na `story_events` pra atualizar sem refresh.

## Fase E3 — Responder DM (opcional, depende do App Review)
- [ ] `POST {graph_host}/{graph_version}/{ig_user_id}/messages`, `recipient.id` = sender,
      dentro da janela 24h. Fora → bloqueado, tratar erro.
- [ ] UI de resposta rápida na inbox.
- [ ] (Opcional) baixar arte do story (`attachment_url`) → Storage antes de expirar.

---

## Riscos / decisões
- **Corpo cru pra HMAC**: garantir `request.text()` antes de qualquer parse; nada de
  middleware reserializando o body — quebra a assinatura.
- **Webhook resolve secret depois do body**: precisa ler `recipient.id` do JSON pra achar a
  conta → secret. Ordem: parse leve pra pegar recipient → resolve secret → valida HMAC
  sobre o raw → só então confia. Documentar bem (parse-antes-de-validar é área sensível).
- **Um app = uma callback URL**: no híbrido, contas central usam a URL/secret central.
  Contas BYO que quiserem webhook teriam que apontar o próprio app pra **nossa** URL e nós
  validamos com o secret delas — funciona porque resolvemos por conta. BYO sem webhook
  configurado no app dele simplesmente não recebe (aceitável; webhook é feature do central).
- **App Review**: `instagram_business_manage_messages` = bloqueador externo (S4). Dev com
  conta de teste funciona sem.
- **`messages` traz TODA DM**, não só story. Filtrar por `attachment.type==story_mention` e
  `reply_to.story`; DM normal → tipo `message` (guardar ou dropar = decisão de produto).
- **Latência**: responder 200 em segundos. Nada de baixar imagem/publicar no handler.
- **Idempotência/ordem**: `mid unique` dedupe; ordem não importa pra inbox.
- **LGPD**: guarda DM de terceiros (dado pessoal). Definir retenção + purge por conta.
- **Reconexão** (S8): scope novo exige refazer OAuth nas contas existentes.

## Ordem de execução
**E0 (híbrido)** → **E1 (webhook núcleo)** → validar com túnel + conta teste (S6) → **E2
(inbox)**. **E3 (responder)** só após App Review (S4). E0 entrega valor sozinho (onboarding
1-clique) mesmo sem o resto.

## Dependências / bloqueadores externos
- App Review da Meta pro messaging (S4) — trava só E3 e o uso em prod do inbound; dev ok.
- Business verification da Meta (S2) pro app central.
- Migrations aplicadas no Supabase (S7).
- Envs preenchidos (S5).

## Esforço
- E0: **M** · E1: **M** · E2: **S/M** · E3: **M** + review (externo).
