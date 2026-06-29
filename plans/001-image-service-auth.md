# Plan 001: Proteger o image-service com um segredo compartilhado

> **Executor instructions**: Siga passo a passo. Rode cada comando de verificação e
> confirme o resultado esperado antes de seguir. Se algo na seção "STOP conditions"
> ocorrer, pare e reporte — não improvise. Ao terminar, atualize a linha de status
> deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: o monorepo estava **não-commitado** quando este
> plano foi escrito (working tree na branch `main`, HEAD `bc4230d`). NÃO confie no
> `git diff` por SHA. Em vez disso, compare os excerpts de "Current state" com o
> código vivo antes de mexer; em divergência, trate como STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: working tree em `main` (HEAD `bc4230d`, mudanças do monorepo não-commitadas), 2026-06-29

## Why this matters

O `image-service` (FastAPI) roda com a **service role key** do Supabase, que bypassa
RLS. O endpoint `POST /process` recebe um campo de formulário `owner` e grava no
Storage na pasta daquele owner — **sem nenhuma autenticação**. Qualquer pessoa que
alcance a URL do serviço pode passar o UUID de qualquer usuário e gravar arquivos na
pasta dele, ou simplesmente martelar o serviço pra estourar cota de Storage e CPU. O
painel Next é o único cliente legítimo; ele deve provar isso com um segredo
compartilhado. Depois deste plano, requisições sem o segredo recebem 401.

## Current state

- `image-service/app/main.py` — app FastAPI. `/health` (público), `/preview` e
  `/process` sem auth. Excerpt atual (linhas ~67-90):

```python
@app.post("/preview")
async def preview(
    file: UploadFile = File(...), caption: str | None = Form(default=None)
) -> Response:
    out = await _read_and_process(file, caption)
    return Response(content=out, media_type="image/jpeg")


@app.post("/process")
async def process(
    owner: str = Form(...),
    file: UploadFile = File(...),
    caption: str | None = Form(default=None),
) -> dict:
    ...
```

- `image-service/app/settings.py` — config via `pydantic-settings`. Padrão do projeto:
  campos opcionais com `None`. Excerpt:

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    supabase_url: str | None = None
    supabase_service_key: str | None = None
    ...
    web_origin: str = "http://localhost:3000"
```

- `web/app/api/preview/route.ts` e `web/app/api/media/create/route.ts` — rotas
  server-side do Next que fazem `fetch(`${base}/preview`)` e `fetch(`${base}/process`)`.
  Hoje sem header de auth. Excerpt de `preview/route.ts`:

```ts
const res = await fetch(`${base}/preview`, { method: "POST", body: incoming });
```

- Convenção Python do repo: `from __future__ import annotations`, type hints, docstrings
  curtas em PT. Veja `image-service/app/storage.py` como exemplar de módulo pequeno.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Instalar deps Python | `cd image-service && pip install -r requirements.txt` | exit 0 |
| Testes do serviço | `cd image-service && pytest -q` | todos passam |
| Build do web | `cd web && npm run build` | exit 0, "Compiled successfully" |
| Lint do web | `cd web && npm run lint` | exit 0 |

## Scope

**In scope:**
- `image-service/app/settings.py`
- `image-service/app/main.py`
- `image-service/app/.env.example` (na verdade `image-service/.env.example`)
- `image-service/tests/test_api.py`
- `web/app/api/preview/route.ts`
- `web/app/api/media/create/route.ts`
- `web/.env.local.example`

**Out of scope (NÃO tocar):**
- `image-service/app/imaging/*` — pipeline de imagem, não tem relação.
- `image-service/app/scheduler.py` — roda dentro do mesmo processo, não recebe HTTP.
- Qualquer policy de RLS no Supabase — outra camada.

## Git workflow

- Branch: `advisor/001-image-service-auth`
- Commits estilo conventional (o repo usa, ex.: `test: foto 002 com overlay de texto`).
- NÃO faça push nem PR a não ser que o operador peça.

## Steps

### Step 1: Adicionar o segredo nas settings

Em `image-service/app/settings.py`, adicione um campo:

```python
    # Segredo compartilhado com o painel (Next). Requisições sem ele -> 401.
    service_shared_secret: str | None = None
```

**Verify**: `cd image-service && python -c "from app.settings import get_settings; print(hasattr(get_settings(), 'service_shared_secret'))"` → `True`

### Step 2: Criar a dependency de auth e aplicar em /preview e /process

Em `image-service/app/main.py`, adicione no topo (após os imports existentes):

```python
import hmac
from fastapi import Header
```

Defina a dependency (depois de `app = FastAPI(...)`):

```python
def require_service_token(x_service_token: str | None = Header(default=None)) -> None:
    expected = settings.service_shared_secret
    if not expected:
        raise HTTPException(status_code=503, detail="SERVICE_SHARED_SECRET não configurado.")
    if not x_service_token or not hmac.compare_digest(x_service_token, expected):
        raise HTTPException(status_code=401, detail="Token de serviço inválido.")
```

Aplique a dependency em `/preview` e `/process` (NÃO em `/health`). Adicione o
parâmetro `_: None = Depends(require_service_token)` a cada um e importe `Depends`:

```python
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Response, UploadFile

@app.post("/preview")
async def preview(
    file: UploadFile = File(...),
    caption: str | None = Form(default=None),
    _: None = Depends(require_service_token),
) -> Response:
    ...

@app.post("/process")
async def process(
    owner: str = Form(...),
    file: UploadFile = File(...),
    caption: str | None = Form(default=None),
    _: None = Depends(require_service_token),
) -> dict:
    ...
```

**Verify**: `cd image-service && python -c "import app.main"` → exit 0 (sem erro de import).

### Step 3: Atualizar os testes da API

Os testes atuais em `image-service/tests/test_api.py` chamam `/preview` sem header e
esperam 200 — vão quebrar de propósito. Ajuste-os e adicione casos de auth.

No topo do arquivo, defina um header válido configurando o segredo via env ANTES de
importar o app não funciona (o app já importou settings). Em vez disso, faça os testes
setarem o segredo no objeto settings cacheado:

```python
from app.settings import get_settings

get_settings().service_shared_secret = "test-secret"
HEADERS = {"X-Service-Token": "test-secret"}
```

Atualize `test_preview_returns_story_jpeg`, `test_preview_rejects_empty_file` e
`test_preview_rejects_garbage` pra passar `headers=HEADERS` no `client.post(...)`.

Adicione dois testes novos:

```python
def test_preview_requires_token():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    r = client.post("/preview", files=files)  # sem header
    assert r.status_code == 401


def test_preview_rejects_wrong_token():
    files = {"file": ("foto.png", _png_bytes(), "image/png")}
    r = client.post("/preview", files=files, headers={"X-Service-Token": "errado"})
    assert r.status_code == 401
```

**Verify**: `cd image-service && pytest -q` → todos passam, incluindo os 2 novos.

### Step 4: Mandar o header do painel (Next)

Em `web/app/api/preview/route.ts`, no `fetch` pro `/preview`, adicione o header:

```ts
const res = await fetch(`${base}/preview`, {
  method: "POST",
  body: incoming,
  headers: { "X-Service-Token": process.env.SERVICE_SHARED_SECRET ?? "" },
});
```

Em `web/app/api/media/create/route.ts`, no `fetch` pro `/process`, idem:

```ts
const procRes = await fetch(`${base}/process`, {
  method: "POST",
  body: fd,
  headers: { "X-Service-Token": process.env.SERVICE_SHARED_SECRET ?? "" },
});
```

**Verify**: `cd web && npm run build` → exit 0. `cd web && grep -rn "X-Service-Token" app/api` → 2 ocorrências.

### Step 5: Documentar a env nos dois exemplos

Em `image-service/.env.example`, adicione:

```
# Segredo compartilhado com o painel (Next). Gere um aleatório e use o MESMO no web.
SERVICE_SHARED_SECRET=
```

Em `web/.env.local.example`, adicione:

```
# Mesmo valor de SERVICE_SHARED_SECRET do image-service.
SERVICE_SHARED_SECRET=
```

**Verify**: `grep -rn "SERVICE_SHARED_SECRET" image-service/.env.example web/.env.local.example` → 2+ ocorrências.

## Test plan

- Modelar pelos testes existentes em `image-service/tests/test_api.py` (usam
  `TestClient`).
- Casos cobertos: `/preview` sem token → 401; token errado → 401; token certo →
  200 (caminho feliz preservado); `/health` continua aberto (já coberto por
  `test_health`, que não usa header — confirme que ainda passa).
- Verificação: `cd image-service && pytest -q` → todos passam.

## Done criteria

- [ ] `cd image-service && pytest -q` exits 0; testes novos de auth existem e passam
- [ ] `cd web && npm run build` exits 0
- [ ] `cd web && npm run lint` exits 0
- [ ] `grep -rn "require_service_token" image-service/app/main.py` retorna ≥1 match
- [ ] Nenhum arquivo fora do "In scope" modificado (`git status`)
- [ ] Linha de status atualizada em `plans/README.md`

## STOP conditions

Pare e reporte se:
- O código em `main.py`/`settings.py` não bater com os excerpts de "Current state"
  (o monorepo evoluiu desde o plano).
- `pytest` falhar duas vezes após tentativa razoável de correção.
- Você perceber que `/health` passou a exigir token (não deve — health check público).
- A correção parecer exigir mexer em arquivo fora do escopo.

## Maintenance notes

- Se no futuro o image-service ganhar endpoints novos que o painel chama, eles também
  precisam de `Depends(require_service_token)`.
- Em produção, `SERVICE_SHARED_SECRET` deve ser um valor aleatório forte (≥32 bytes),
  igual nos dois serviços; rotacione junto.
- Reviewer deve checar: o header não vaza pro client (as rotas Next são server-side; o
  segredo vem de `process.env`, não de `NEXT_PUBLIC_*` — confirme que não virou público).
- Deferido: autenticação mais forte (mTLS/JWT) — overkill pro estágio atual.
