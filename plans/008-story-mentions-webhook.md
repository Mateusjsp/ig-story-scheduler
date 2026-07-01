# Plano 008 — Webhooks de Story (menções + respostas via DM)

## Objetivo
Receber, em tempo real, quando alguém **menciona a conta num story** ou **responde
um story** publicado — ambos chegam como DM pela Instagram API with Instagram Login
(mesmo login/token que o projeto já usa, `graph.instagram.com`). Persistir os eventos
por conta (multi-tenant) e expor na dashboard. Opcional (fase C): responder o DM
dentro da janela de 24h.

> **Correção de premissa**: NÃO precisa Facebook Login nem Graph da Página. O
> Instagram Login já suporta webhooks. O que falta é (1) o scope de mensagens, (2) a
> rota de webhook, (3) a assinatura do app no campo `messages`, (4) App Review da
> Meta pra produção.

## Estado atual (o que já existe)
- OAuth Instagram Login com 2 scopes: `instagram_business_basic`,
  `instagram_business_content_publish` — [start/route.ts:36-39](../web/app/api/instagram/start/route.ts#L36-L39).
- Token longo (60d) cifrado em `ig_accounts.access_token_enc`, refresh diário no
  [scheduler.py:106](../image-service/app/scheduler.py#L106).
- `ig_app_credentials` guarda `app_id` + `app_secret_enc` por owner (usado no
  callback pra trocar code→token). O `app_secret` é o mesmo que valida a assinatura
  do webhook (`X-Hub-Signature-256`).
- Publicação de story funciona ([graph_api.py](../image-service/app/publishing/graph_api.py)).

**Nada de webhook/inbound existe hoje.** Fluxo é 100% outbound (publicar).

---

## Arquitetura — decisão-chave: onde mora o endpoint?

Meta faz `GET` (verificação) + `POST` (eventos) numa **URL pública única** por app.
Duas opções:

| Opção | Prós | Contras |
|-------|------|---------|
| **A — rota no `web/` (Next.js)** ✅ recomendado | mesma origem pública já em prod; tem acesso ao Supabase e ao `app_secret` (via `ig_app_credentials`); TS já valida HMAC fácil | roda em serverless (cold start ok pra webhook) |
| B — no `image-service/` (FastAPI) | perto do scheduler | image-service pode não ter URL pública; duplicaria acesso a credenciais |

**Escolha: A.** Webhook é I/O leve (validar assinatura + gravar linha). O image-service
continua só publicando. Um app Meta = uma callback URL; como as credenciais Meta são
**por-owner** (multi-tenant sobre potencialmente múltiplos apps Meta), ver "Risco
multi-app" abaixo.

---

## Modelo de dados (migration nova `0009_story_events.sql`)

```sql
create type story_event_type as enum ('story_mention', 'story_reply', 'message');

create table story_events (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null references auth.users(id) on delete cascade,
  account_id     uuid references ig_accounts(id) on delete cascade,
  ig_user_id     text not null,              -- conta que recebeu (recipient)
  type           story_event_type not null,
  sender_ig_id   text,                       -- quem mandou/mencionou
  sender_username text,
  message_text   text,                       -- texto da reply, se houver
  attachment_url text,                       -- CDN do story mencionado (expira!)
  raw            jsonb not null,             -- payload cru pra auditoria
  mid            text unique,                -- message id da Meta (idempotência)
  received_at    timestamptz not null default now()
);
create index story_events_account_idx on story_events(account_id, received_at desc);

alter table story_events enable row level security;
create policy "story_events owner" on story_events
  for all using (owner = auth.uid()) with check (owner = auth.uid());
-- inserts vêm da service role (webhook) => bypassa RLS.
```

Notas:
- `mid unique` = idempotência: Meta re-entrega em falha; upsert `on conflict do nothing`.
- `attachment_url` do story é **CDN temporária** — se quiser guardar a arte, baixar e
  jogar no Storage (fase C, opcional).
- Resolver `account_id`/`owner` a partir do `recipient.id` (= `ig_user_id`) do payload,
  fazendo lookup em `ig_accounts`. Se não achar conta, dropar evento (não é nossa).

---

## Fatias (cada uma deployável)

### Slice A — Handshake + ingestão (núcleo)
Entrega: Meta consegue verificar a URL e nós gravamos eventos. Sem UI.

1. **Scope**: add `instagram_business_manage_messages` no
   [start/route.ts:36-39](../web/app/api/instagram/start/route.ts#L36-L39). Contas já
   conectadas precisam **reconectar** pra concederem o novo scope (o token velho não
   tem permissão de messaging).
2. **Rota** `web/app/api/instagram/webhook/route.ts`:
   - `GET`: lê `hub.mode`, `hub.verify_token`, `hub.challenge`. Se `verify_token` ==
     `process.env.META_WEBHOOK_VERIFY_TOKEN`, responde `hub.challenge` em texto puro.
   - `POST`: **1º valida `X-Hub-Signature-256`** = `sha256=HMAC(app_secret, rawBody)`.
     Precisa do corpo **cru** (não parseado) — usar `await request.text()` e só depois
     `JSON.parse`. App secret: ver "Risco multi-app". Assinatura inválida → `403`.
   - Parseia `entry[].messaging[]`; classifica: `message.attachments[].type ==
     "story_mention"` → `story_mention`; texto simples que referencia story → `story_reply`
     (a Meta manda `reply_to.story` em alguns casos); senão `message`.
   - Upsert em `story_events` (service role client). Responde **`200` sempre e rápido**
     (Meta desinscreve endpoints lentos/erro). Processamento pesado → fila/depois.
3. **Env**: `META_WEBHOOK_VERIFY_TOKEN` (string qualquer que a gente inventa, casa com o
   painel Meta). Documentar no `web/.env.example`.
4. **Painel Meta** (manual, fora do código): App Dashboard → Webhooks → produto
   Instagram → callback URL `https://<site>/api/instagram/webhook`, verify token, e
   inscrever o field **`messages`**. Além disso, por conta:
   `POST /{ig-user-id}/subscribed_apps?subscribed_fields=messages` (fazer no callback do
   OAuth, logo após salvar a conta — ver Slice A.5).
5. **Subscribe automático da conta**: no
   [callback/route.ts:77](../web/app/api/instagram/callback/route.ts#L77), após upsert
   da conta, chamar `POST {graph_host}/{ig_user_id}/subscribed_apps` com o token.

**Teste local**: túnel HTTPS (cloudflared/ngrok) → configurar como callback num app de
teste da Meta; usar conta de teste. Não precisa App Review em dev.

### Slice B — UI (inbox por conta)
1. Página `web/app/dashboard/accounts/[id]/mentions` (ou aba na conta): lista
   `story_events` da conta, mais recentes primeiro, com thumb (`attachment_url`), sender,
   texto, timestamp. Server component + query RLS-safe (owner).
2. Badge de "novos" (contagem desde último visto) — opcional, campo `read_at`.
3. Realtime opcional: Supabase Realtime na `story_events` pra aparecer sem refresh.

### Slice C — Responder DM (opcional, mais App Review)
1. `POST {graph_host}/{ig_user_id}/messages` com `recipient.id` = sender, dentro da
   **janela de 24h** desde a última msg do user. Fora da janela = bloqueado pela Meta.
2. UI de resposta rápida na inbox.
3. Baixar arte do story (`attachment_url` → Storage) antes de expirar, se quiser
   arquivar/repostar.

---

## Riscos / decisões

- **Risco multi-app (importante)**: as credenciais Meta são **por-owner**
  (`ig_app_credentials`), i.e. cada usuário do SaaS pode ter o **próprio App Meta**. Mas
  um App Meta tem **uma** callback URL e **um** `app_secret`. Duas saídas:
  - **C1 (SaaS real)**: nós rodamos **um App Meta central** (nosso), todos os usuários
    conectam via ele → um único `app_secret`/verify token, assinatura simples. Isso
    contradiz o `ig_app_credentials` por-owner atual — seria uma mudança de modelo de
    produto (decisão do mantenedor).
  - **C2 (BYO-app, como hoje)**: cada owner traz seu app → o webhook precisa descobrir
    **qual `app_secret`** valida a assinatura. Como o payload traz o `recipient.id`
    (ig_user_id), dá pra achar a conta → o owner → o `app_secret_enc` dele. Mas isso é
    **depois** de já ter o corpo; validar HMAC exige testar contra o secret certo. Viável
    (lookup por ig_user_id no JSON antes de validar), só mais chato. **Recomendo C2** pra
    não quebrar o modelo atual.
- **App Review**: `instagram_business_manage_messages` exige revisão da Meta pra sair do
  modo dev (contas de teste funcionam sem). Planejar screencast do fluxo. **Bloqueador
  externo** — mesma categoria dos blockers já mapeados no [MEMORY]/SaaS pivot.
- **Corpo cru pra HMAC**: no Next, garantir leitura de `request.text()` antes de qualquer
  parse; middleware que reserialize quebra a assinatura.
- **Idempotência + ordem**: Meta pode reentregar e fora de ordem. `mid unique` +
  `received_at` resolvem dedupe; ordem não importa pra inbox.
- **Latência**: responder 200 em < poucos segundos. Nada de publicar/baixar imagem no
  handler — enfileirar.
- **Só menção/reply?** O field `messages` traz **todas** as DMs, não só story. Filtrar por
  `attachment.type == story_mention` e por `reply_to.story`. DM normal → tipo `message`
  (guardar ou dropar, decisão de produto).
- **Privacidade/LGPD**: guardar conteúdo de DM de terceiros = dado pessoal. Documentar
  retenção; permitir purge por conta.

## Ordem de execução
Slice A (handshake + ingestão + subscribe) → validar com túnel e conta de teste →
Slice B (inbox UI). Slice C (responder) só depois do App Review, é incremento.

## Dependências / bloqueadores externos
- **App Review da Meta** pro scope de messaging (produção). Dev funciona sem.
- **Decisão de produto**: modelo de app central (C1) vs BYO-app (C2). Recomendo C2.
- URL pública HTTPS estável (prod já tem; dev = túnel).

## Esforço
- Slice A: **M** (rota + HMAC + migration + subscribe no callback).
- Slice B: **S/M** (uma página + query).
- Slice C: **M** + review (bloqueado externamente).
