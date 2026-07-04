# Plan 013: Impedir publicação duplicada no Instagram (idempotência do publish)

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: compare os excerpts de "Current state" com o
> código vivo (o working tree pode ter mudanças não commitadas). Divergência
> real = STOP.
> `git diff --stat 2db4580..HEAD -- image-service/app/scheduler.py supabase/migrations/`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (mexe no caminho crítico de publicação)
- **Depends on**: none (o plano 014 depende deste)
- **Category**: bug
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

Hoje o fluxo é *at-least-once sem deduplicação*: `_publish_one` publica na Meta
e **só depois** grava `status='published'`. Dois cenários duplicam um post real
no Instagram do usuário:

1. **Falha no update pós-publish**: se o `update` do Supabase falhar (blip de
   rede), o `except` genérico devolve o post pra `queued` (attempts < 3) e ele é
   republicado.
2. **Crash entre publish e update**: o post fica em `publishing`; `requeue_stuck`
   devolve pra `queued` após 10 min e ele é republicado.

`media_publish` da Meta não é idempotente e nada checa `ig_media_id` antes de
publicar de novo. Post duplicado no feed do cliente é o pior tipo de bug para um
SaaS de agendamento.

## Current state

- `image-service/app/scheduler.py:59-110` — `_publish_one`. Ordem atual:
  publica → atualiza banco → `except` devolve pra fila:
  ```python
  if post.get("target") == "feed":
      ig_media_id = publisher.publish_feed(image_url, caption=(media or {}).get("feed_caption"))
  else:
      ig_media_id = publisher.publish_story(image_url)
  sb.table("posts").update({"status": "published", "ig_media_id": ig_media_id, ...}).eq("id", pid).execute()
  ...
  except Exception as exc:  # noqa: BLE001
      attempts = post.get("attempts", 0)  # claim já incrementou
      status = "queued" if attempts < MAX_ATTEMPTS else "failed"
      sb.table("posts").update({"status": status, "error": str(exc)}).eq("id", pid).execute()
  ```
- `image-service/app/scheduler.py:33-45` — `requeue_stuck` devolve pra `queued`
  qualquer post em `publishing` com `updated_at` > 10 min, sem olhar se a
  publicação na Meta chegou a acontecer.
- O publish é em 3 passos (`app/publishing/graph_api.py`):
  `_create_container` (POST /media → `container_id`) → `_wait_until_ready` →
  `_publish_container` (POST /media_publish → `ig_media_id`). O ponto sem volta
  é o `media_publish`; criar container é inócuo (container não publicado expira).
- Schema `posts` (migration `0001_init.sql`): já tem `ig_media_id text` e
  `error text`. Não há coluna para o container.
- Padrão de teste: `tests/test_scheduler.py` usa `MagicMock` + `patch.object`.

## Commands you will need

| Purpose | Command (rodar em `image-service/`) | Expected on success |
|---------|-------------------------------------|---------------------|
| Testes | `pytest -q` | todos passam (hoje: 40) |

Migration nova: **não** aplicar em banco nenhum — só criar o arquivo `.sql`
(não há projeto Supabase live no repo; aplicação é manual pelo mantenedor).

## Scope

**In scope**:
- `image-service/app/scheduler.py`
- `image-service/tests/test_scheduler.py`
- `supabase/migrations/0010_publish_marker.sql` (criar)

**Out of scope**:
- `image-service/app/publishing/graph_api.py` — a assinatura de `publish()` não
  muda (o retorno já é o `ig_media_id`). Exceção permitida: expor o
  `container_id` via callback/atributo se o Step 2 exigir (ver nota lá).
- `web/` inteiro.
- Retry/backoff da Meta (fora de escopo; plano 014 trata concorrência).

## Git workflow

- Branch atual (`main`), conventional commit, ex.:
  `fix: make publish idempotent (no duplicate IG posts on retry)`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Guarda de curto-circuito antes de publicar

Em `_publish_one`, antes de montar o publisher, reler o post e abortar se já
existe `ig_media_id` (protege contra requeue de um post que já publicou):

```python
fresh = (
    sb.table("posts").select("ig_media_id").eq("id", pid).single().execute().data
)
if fresh and fresh.get("ig_media_id"):
    sb.table("posts").update(
        {"status": "published", "error": None}
    ).eq("id", pid).execute()
    log.info("post %s já publicado (%s) — só consertando status", pid, fresh["ig_media_id"])
    return
```

Nota: o dict `post` vem do claim e pode estar defasado; por isso a releitura.

**Verify**: `pytest -q` → verde (testes existentes não quebram).

### Step 2: Persistir `ig_media_id` de forma resiliente

O update pós-publish é o elo frágil. Envolver em retry curto para que uma falha
transitória do Supabase não jogue um post JÁ PUBLICADO de volta pra fila:

```python
def _mark_published(sb, pid: str, ig_media_id: str) -> None:
    last: Exception | None = None
    for _ in range(3):
        try:
            sb.table("posts").update(
                {"status": "published", "ig_media_id": ig_media_id,
                 "published_at": _now().isoformat(), "error": None}
            ).eq("id", pid).execute()
            return
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2)
    raise PublishedButNotRecorded(ig_media_id) from last
```

Criar a exceção `class PublishedButNotRecorded(Exception)` no módulo. No
`except` de `_publish_one`, tratá-la **separado** do erro genérico: marcar o
post como `failed` com `error = f"publicado na Meta ({ig_media_id}) mas não
gravado — verificar manualmente"` — nunca devolver pra `queued` (isso é o que
duplica). Se até esse update de `failed` falhar, apenas logar em nível ERROR.

(Adicionar `import time` no topo se ainda não houver.)

**Verify**: `pytest -q` → verde.

### Step 3: Ordem do erro genérico continua igual

Conferir que o caminho de erro **antes** do publish (media sem URL, decrypt,
container ERROR) continua devolvendo pra `queued`/`failed` como hoje — esses
podem tentar de novo com segurança, o post não saiu na Meta.

**Verify**: `pytest -q` → verde.

### Step 4: Migration de índice/comentário (documentação do invariante)

Criar `supabase/migrations/0010_publish_marker.sql`:

```sql
-- Invariante de idempotência: um post com ig_media_id preenchido JÁ SAIU na
-- Meta e nunca deve voltar pra 'queued'. O scheduler curto-circuita nele.
comment on column posts.ig_media_id is
  'ID da mídia publicada na Meta. Preenchido = já publicado (nunca reenfileirar).';
create index if not exists idx_posts_status_sched
  on posts (status, scheduled_at);
```

(O índice cobre a consulta do claim e do pg_cron; se preferir, só o comment —
mas o índice é barato e a query `status = 'queued' and scheduled_at <= now()`
roda a cada minuto em duas vias.)

**Verify**: arquivo criado; `pytest -q` segue verde (migration não roda em teste).

### Step 5: Testes novos

Em `tests/test_scheduler.py`, no padrão MagicMock existente:

1. `test_publish_one_skips_when_already_published`: mock retorna
   `ig_media_id="m1"` na releitura → publisher **não** é chamado; update final
   tem `status="published"`.
2. `test_published_but_not_recorded_goes_failed_not_queued`: publisher retorna
   id; updates de `published` levantam exceção 3x → o update final tem
   `status="failed"` e o error menciona o id; **nenhum** update com
   `status="queued"`.
3. `test_pre_publish_error_requeues`: publisher levanta antes de publicar
   (ex.: `RuntimeError`) com attempts=1 → update com `status="queued"`.

**Verify**: `pytest -q` → todos passam, incluindo os 3 novos.

## Test plan

Coberto no Step 5. Padrão estrutural: `tests/test_scheduler.py`.
Cuidado com o mock em cadeia: `sb.table(...).select(...).eq(...).single().execute().data`
e `sb.table(...).update(...).eq(...).execute()` precisam de `MagicMock`
configurado por chamada (usar `side_effect` para diferenciar a releitura do
update).

## Done criteria

- [ ] `pytest -q` exit 0 com os 3 testes novos
- [ ] Nenhum caminho do código devolve pra `queued` um post cujo publish na Meta retornou id (leitura do diff confirma)
- [ ] `supabase/migrations/0010_publish_marker.sql` criado
- [ ] `git status` limpo fora do escopo
- [ ] `plans/README.md` atualizado (nota: migration 0010 precisa ser aplicada manualmente no Supabase)

## STOP conditions

- Os excerpts de "Current state" não baterem com o código.
- Perceber que precisa mudar a assinatura de `Publisher.publish` — o plano
  assume que não; se precisar, pare e reporte.
- O cenário "crash duro entre media_publish e qualquer update" (janela de
  milissegundos) exigiria gravar o container_id antes do publish; isso é
  melhoria adicional — se você julgar necessário fazê-la agora, PARE e reporte
  em vez de expandir o escopo.

## Maintenance notes

- O plano 014 (concorrência/janela de requeue) assume este plano aplicado — o
  curto-circuito por `ig_media_id` é a rede de segurança dele.
- Janela residual: crash do processo (kill -9) exatamente entre o retorno do
  `media_publish` e o primeiro update ainda pode duplicar. Fechar 100% exige
  persistir o `container_id` antes do publish e reconciliar na Meta — deferido
  (custo/benefício baixo para o volume atual; reavaliar com escala).
- Revisor: cheque que `PublishedButNotRecorded` nunca cai no ramo que seta
  `queued`.
