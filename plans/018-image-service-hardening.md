# Plan 018: Defesa em profundidade no image-service e nas policies SQL

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: compare os excerpts de "Current state" com o
> código vivo. Divergência real = STOP.
> `git diff --stat 2db4580..HEAD -- image-service/app/main.py image-service/app/imaging/media.py image-service/app/imaging/document.py web/app/api/preview/route.ts web/app/api/normalize/route.ts "web/app/api/schedule/[id]/route.ts"`

## Status

- **Priority**: P2
- **Effort**: M (várias mudanças S independentes)
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (defesa em profundidade)
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

O image-service roda com a **service role** do Supabase (bypassa RLS) e confia
100% no chamador (web + segredo compartilhado). Hoje ele não valida nada do que
recebe: `owner` e `original_path` arbitrários permitem ler/escrever qualquer
pasta do bucket se o segredo vazar ou se uma rota web tiver IDOR; `target`
desconhecido cai silenciosamente em story 9:16 (o plano 009 especificava
"Validar → 400" — não foi implementado); um `doc` com milhares de elementos
segura CPU e faz fetches seriais de emoji. No SQL, a função SECURITY DEFINER
`trigger_due_publish` fica executável por qualquer role autenticada (grant
default do Postgres) e a policy de UPDATE do Storage não tem `with check`.
Nenhum item é exploração direta hoje — juntos, são a diferença entre "um vazamento
de segredo é contido" e "um vazamento de segredo vira acesso cross-tenant total".

## Current state

- `image-service/app/imaging/media.py:29-39` — fallback silencioso:
  ```python
  TARGET_SIZES = {"story": STORY_SIZE, "feed_45": (1080, 1350), "feed_11": (1080, 1080)}
  DEFAULT_TARGET = "story"
  def resolve_size(target: str | None) -> tuple[int, int]:
      return TARGET_SIZES.get(target or DEFAULT_TARGET, STORY_SIZE)
  ```
- `image-service/app/main.py:181-213` (`/process`) e `:216-244` (`/reprocess`) —
  `owner: str = Form(...)`, `original_path: str = Form(...)`,
  `old_processed_path` opcional; nenhum vínculo entre eles. Storage helpers
  (`app/storage.py:15-43`) montam `f"{owner}/processed/{uuid}.jpg"` e baixam
  qualquer `path`.
- `image-service/app/imaging/document.py:71-74` — `elements: list[Element] =
  Field(default_factory=list)` sem cap; cada sticker vira fetch de CDN
  (`app/imaging/emoji.py:31`, urlopen 10s de timeout, serial).
- `supabase/migrations/0005_pg_cron_publish.sql:28-70` — `trigger_due_publish()`
  `security definer`, schema `public`, lê `vault.decrypted_secrets`, sem
  `revoke execute`.
- `supabase/migrations/0002_storage.sql:15-20` — policy de update só com
  `using`, sem `with check`:
  ```sql
  create policy "media update own folder" on storage.objects
    for update to authenticated
    using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
  ```
- `web/app/api/preview/route.ts:4-18` e `web/app/api/normalize/route.ts:5-15` —
  únicas rotas de API sem `supabase.auth.getUser()` local (dependem só do
  middleware global). Exemplar da guarda: `web/app/api/media/create/route.ts:16-20`.
- `web/app/api/schedule/[id]/route.ts:78` — repassa `body.target` cru ao
  `/reprocess`: `if (typeof body.target === "string") fd.append("target", body.target);`
  (o conjunto válido está em `TARGETS`, `web/lib/story-doc.ts:27-55`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Testes python | `pytest -q` (em `image-service/`) | todos passam |
| Lint web | `npm run lint` (em `web/`) | exit 0 |
| Build web | `npm run build` (em `web/`) | exit 0 |

Migrations novas: só criar os arquivos; aplicação no Supabase é manual (não há
projeto live no repo).

## Scope

**In scope**:
- `image-service/app/main.py`
- `image-service/app/imaging/media.py`
- `image-service/app/imaging/document.py`
- `image-service/tests/test_api.py`, `image-service/tests/test_document.py`
- `web/app/api/preview/route.ts`, `web/app/api/normalize/route.ts`
- `web/app/api/schedule/[id]/route.ts` (só a validação de `body.target`)
- `supabase/migrations/0011_harden_policies.sql` (criar)

**Out of scope**:
- `claim_due_posts` (0003): `language sql` sem SECURITY DEFINER — herda o
  invocador; revisada e ok.
- Trocar o modelo de auth do image-service (segredo compartilhado é decisão do
  plano 001).
- Rate limiting.

## Git workflow

- Branch atual (`main`), conventional commit, ex.:
  `feat: defense-in-depth validation in image-service and SQL policies`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: `target` desconhecido → 400

Em `media.py`, adicionar ao lado de `resolve_size`:

```python
def validate_target(target: str | None) -> str:
    """Nome do destino validado. Desconhecido -> ValueError (endpoint devolve 400)."""
    t = target or DEFAULT_TARGET
    if t not in TARGET_SIZES:
        raise ValueError(f"target inválido: {t!r} (use {sorted(TARGET_SIZES)})")
    return t
```

Em `main.py`, no início de `/preview`, `/process` e `/reprocess`:

```python
try:
    target = validate_target(target)
except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc))
```

(import: `from app.imaging.media import ..., validate_target`). `resolve_size`
continua como está (chamado depois com target já validado).

**Verify**: `pytest -q` → verde; teste novo no Step 5 cobre o 400.

### Step 2: Vincular caminhos do Storage ao `owner`

Em `main.py` (`/reprocess`), antes do `download`:

```python
for p in (original_path, old_processed_path):
    if p and not p.startswith(f"{owner}/"):
        raise HTTPException(status_code=403, detail="path fora da pasta do owner.")
```

Também validar o shape do owner (UUID) nos dois endpoints:

```python
import uuid as _uuid
try:
    _uuid.UUID(owner)
except ValueError:
    raise HTTPException(status_code=400, detail="owner inválido.")
```

**Verify**: `pytest -q` → verde.

### Step 3: Cap de elementos no doc

Em `document.py`, na classe `StoryDoc`:

```python
elements: list[Element] = Field(default_factory=list, max_length=40)
```

(40 = folga ampla sobre uso real do editor; Pydantic v2 valida `max_length` em
listas e o `_parse_doc` de `main.py:122-127` já converte o erro em 400.)

**Verify**: `pytest -q` → verde.

### Step 4: Auth local em `preview`/`normalize` + validação de `target` no PUT

Nas duas rotas web (`preview/route.ts`, `normalize/route.ts`), adicionar no
topo a mesma guarda de `media/create/route.ts:16-20`:

```ts
import { createClient } from "@/lib/supabase/server";
...
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
```

Em `schedule/[id]/route.ts:78`, validar contra `TARGETS`:

```ts
if (typeof body.target === "string" && body.target in TARGETS) {
  fd.append("target", body.target);
}
```

(import `TARGETS` de `@/lib/story-doc` — o arquivo já importa `docCaption` de lá.)

**Verify**: `npm run lint` e `npm run build` → exit 0.

### Step 5: Testes python

Em `tests/test_api.py` (usa `TestClient` do FastAPI — seguir o padrão dos
testes existentes no arquivo, incluindo o header `X-Service-Token`):

1. `/process` com `target="feed"` (valor do enum do banco, não do render) → 400.
2. `/reprocess` com `original_path="OUTRO-UUID/original/x"` e `owner` diferente
   → 403.
3. `/process` com `owner="nao-e-uuid"` → 400.

Em `tests/test_document.py`: doc com 41 elementos → `ValidationError`.

**Verify**: `pytest -q` → todos passam, incluindo os novos.

### Step 6: Migration de hardening SQL

Criar `supabase/migrations/0011_harden_policies.sql`:

```sql
-- Função SECURITY DEFINER não deve ser executável via PostgREST por clientes.
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
```

**Verify**: arquivo criado; sintaxe conferida por leitura (não há banco pra
aplicar — anotar no README dos planos que 0011 é aplicação manual).

## Test plan

Coberto no Step 5. Padrões: `tests/test_api.py` (TestClient + service token),
`tests/test_document.py` (Pydantic).

## Done criteria

- [ ] `pytest -q` exit 0 com os 4 testes novos
- [ ] `npm run lint` e `npm run build` exit 0
- [ ] `/process`, `/preview`, `/reprocess` devolvem 400 para target desconhecido (teste prova)
- [ ] `/reprocess` devolve 403 para path fora de `{owner}/` (teste prova)
- [ ] `supabase/migrations/0011_harden_policies.sql` criado
- [ ] `git status` limpo fora do escopo
- [ ] `plans/README.md` atualizado (0011 = aplicar manualmente)

## STOP conditions

- Os excerpts não baterem com o código.
- Algum teste existente de `/process`/`/reprocess` usar `owner` que não é UUID
  (a validação do Step 2 quebraria) — ajustar o teste é ok se for claramente
  fixture; se o WEB mandar owner não-UUID em algum fluxo real, PARE e reporte.
- `max_length` de lista não suportado na versão do Pydantic instalada (checar
  `pip show pydantic` ≥ 2.x) — reporte em vez de trocar por validator custom.

## Maintenance notes

- Se o web um dia mandar `posts.target` (`"feed"`) direto pro serviço, o Step 1
  falha alto (400) em vez de renderizar 9:16 errado — comportamento desejado;
  mapear no web (`TARGETS`) antes de enviar.
- Endpoint novo no image-service = repetir o padrão: validar owner UUID +
  prefixo de path + limites de payload.
- Revisor SQL: `drop policy if exists` + recreate é idempotente e seguro de
  reaplicar.
