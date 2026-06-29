# Darkroom — agendador de Stories (SaaS multi-conta)

Painel multi-usuário pra agendar **Stories do Instagram**. Cada usuário conecta
contas via **OAuth**, sobe fotos, escreve legenda com **preview do tratamento
inteligente** (enquadramento 9:16 + texto que desvia de áreas agitadas e rostos),
agenda e o sistema **publica sozinho 24/7**.

## Arquitetura (monorepo)

```
web/            Next.js 16 (App Router) — painel. Deploy: Vercel
image-service/  FastAPI (Python) — tratamento de imagem + publicação + scheduler.
                Deploy: Railway/Render (sempre no ar). Reusa o core de imagem.
supabase/       migrations SQL (schema + RLS multi-tenant + bucket Storage)
```

Fluxo: o painel faz auth/CRUD/upload via Supabase; o OAuth troca `code`→token e
salva a conta (token cifrado AES-256-GCM). Ao agendar, o painel chama o
image-service `/process` (trata + grava no Storage → URL pública) e cria um `post`.
Um **scheduler** (APScheduler) dentro do image-service publica os posts vencidos e
renova tokens automaticamente.

```
[Next.js/Vercel] ──auth/CRUD/upload──> [Supabase: Postgres+Auth+Storage]
       │ OAuth callback                          ▲
       │ /process, agendar                       │ lê fila/contas (service role)
       ▼                                          │
[image-service/Railway] ── publica posts vencidos, refresh de token (24/7)
```

## Por que o serviço Python é separado
O tratamento usa OpenCV/numpy/Pillow (pesado pra serverless) e a publicação faz
*polling* do container da Meta até `FINISHED` (~até 60s, estoura timeout
serverless). Um serviço sempre-no-ar com APScheduler resolve e reaproveita o core
de imagem já testado (blur fill + placement por busyness + desvio de rosto).

---

## Setup

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com).
2. Aplique as migrations `supabase/migrations/*.sql` (SQL Editor ou `supabase db push`).
   Isso cria as tabelas, RLS por tenant e o bucket público `media`.
3. Pegue em **Project Settings → API**: `Project URL`, `anon key`, `service_role key`.

### 2. image-service (local)
```bash
cd image-service
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # preencha SUPABASE_*, INSTAGRAM_*, TOKEN_ENC_KEY
uvicorn app.main:app --reload   # http://localhost:8000
pytest                          # testes do core de imagem + API
```

### 3. web (local)
```bash
cd web
npm install
cp .env.local.example .env.local   # preencha NEXT_PUBLIC_SUPABASE_*, IMAGE_SERVICE_URL, INSTAGRAM_*
npm run dev                        # http://localhost:3000
```

> **TOKEN_ENC_KEY** precisa ser o **mesmo** no `web/.env.local` e no
> `image-service/.env` (o painel cifra, o serviço decifra). Gere com:
> `python -c "import secrets; print(secrets.token_urlsafe(32))"`

### 4. Meta / Instagram (OAuth)
1. App no [Meta for Developers](https://developers.facebook.com) com o caso de uso
   **"Gerenciar mensagens e conteúdo no Instagram"** (login do Instagram).
2. Redirect OAuth: `https://SEU-PAINEL/api/instagram/callback` (local:
   `http://localhost:3000/api/instagram/callback`).
3. Preencha `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET` (Instagram app secret).
4. Adicione sua conta como **tester** (pula App Review pra contas próprias).

> ⚠️ **App Review + Verificação de empresa**: pra publicar em contas de **terceiros**
> (SaaS público) com `instagram_business_content_publish`, a Meta exige App Review e
> verificação. Em contas tester (suas) funciona sem. Comece com testers, tramite o
> review em paralelo.

### 5. Deploy
- **web → Vercel**: importe `web/`, configure as envs, redirect OAuth pra URL de prod.
- **image-service → Railway/Render**: deploy via `Dockerfile`, configure as envs. O
  scheduler sobe junto (publica/renova sozinho).

## Verificação ponta a ponta
1. `pytest` no image-service (core + API verdes).
2. Login no painel → conectar conta (OAuth) → `ig_accounts` populado.
3. Estúdio: upload + legenda → **Preview** mostra o Story tratado.
4. Agendar pra +2 min → o scheduler publica → `posts.status=published`, Story no ar.
5. Multi-tenant: 2º usuário não vê dados do 1º (RLS).

## Stack
Next.js 16 · React 19 · Tailwind v4 · Supabase (Postgres/Auth/Storage) ·
FastAPI · Pillow/numpy/OpenCV · APScheduler · Meta Content Publishing API.
