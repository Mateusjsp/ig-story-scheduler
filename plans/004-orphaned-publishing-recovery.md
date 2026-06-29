# Plan 004: Recuperar posts presos em "publishing"

> **Executor instructions**: Siga passo a passo, rode cada verificação, STOP nas
> condições. Ao fim, atualize `plans/README.md`.
>
> **Drift check**: monorepo **não-commitado** (working tree `main`, HEAD `bc4230d`).
> Compare excerpts com o código vivo; divergência = STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: working tree em `main` (HEAD `bc4230d`, não-commitado), 2026-06-29

## Why this matters

No scheduler, `_publish_one` marca o post como `publishing` ANTES de chamar a Meta. Se
o processo morre (deploy, crash, OOM) entre marcar `publishing` e o update final, o
post fica **preso em `publishing` pra sempre**: o `publish_due` só pega `queued`, então
ele nunca mais é tentado nem reportado. A foto agendada simplesmente nunca sai. Este
plano adiciona uma rotina que devolve pra `queued` os posts presos em `publishing` há
mais de N minutos, pra que o ciclo normal de retry os pegue.

## Current state

- `image-service/app/scheduler.py` — `publish_due()` busca `queued` vencidos;
  `_publish_one()` faz a transição. Excerpts:

```python
def publish_due() -> None:
    sb = get_supabase()
    due = (
        sb.table("posts")
        .select(... )
        .eq("status", "queued")
        .lte("scheduled_at", _now().isoformat())
        .limit(20)
        .execute()
    )
    for post in due.data or []:
        _publish_one(sb, post)

def _publish_one(sb, post: dict) -> None:
    pid = post["id"]
    ...
    sb.table("posts").update(
        {"status": "publishing", "attempts": post.get("attempts", 0) + 1}
    ).eq("id", pid).execute()
    try:
        ...
```

- A tabela `posts` tem `updated_at timestamptz` com trigger `posts_updated` que seta
  `updated_at = now()` em cada UPDATE (ver `supabase/migrations/0001_init.sql`). Logo,
  um post que entrou em `publishing` tem `updated_at` = momento da transição.
- `MAX_ATTEMPTS = 3` já existe no topo do arquivo. Em falha, `_publish_one` volta pra
  `queued` se `attempts < MAX_ATTEMPTS`, senão `failed`.
- Convenção: funções de job no nível do módulo, chamadas pelo `BackgroundScheduler` em
  `start_scheduler()`. `_now()` retorna `datetime.now(timezone.utc)`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Testes do serviço | `cd image-service && pytest -q` | todos passam |
| Import sanity | `cd image-service && python -c "import app.scheduler"` | exit 0 |

## Scope

**In scope:**
- `image-service/app/scheduler.py`
- `image-service/tests/test_scheduler.py` (criar)

**Out of scope (NÃO tocar):**
- `supabase/migrations/*` — não precisa de mudança de schema (`updated_at` já existe).
- `image-service/app/publishing/graph_api.py` — a publicação em si não muda.
- A lógica de concorrência multi-instância — é o Plan 005, separado.

## Git workflow

- Branch: `advisor/004-orphaned-publishing-recovery`
- Commits conventional.
- Sem push/PR salvo instrução.

## Steps

### Step 1: Adicionar `requeue_stuck()`

Em `image-service/app/scheduler.py`, adicione uma constante perto de `MAX_ATTEMPTS`:

```python
STUCK_MINUTES = 10  # post em "publishing" além disso = órfão, volta pra fila
```

Adicione a função (perto de `publish_due`):

```python
def requeue_stuck() -> None:
    """Devolve pra 'queued' posts presos em 'publishing' (processo morreu no meio)."""
    sb = get_supabase()
    cutoff = (_now() - timedelta(minutes=STUCK_MINUTES)).isoformat()
    stuck = (
        sb.table("posts")
        .update({"status": "queued", "error": "reenfileirado após travar em publishing"})
        .eq("status", "publishing")
        .lt("updated_at", cutoff)
        .execute()
    )
    if stuck.data:
        log.warning("%d post(s) reenfileirado(s) (travados em publishing)", len(stuck.data))
```

`timedelta` já é importado no topo (`from datetime import datetime, timedelta, timezone`).
Confirme; se não estiver, adicione.

**Verify**: `cd image-service && python -c "import app.scheduler"` → exit 0.

### Step 2: Rodar a recuperação antes de cada ciclo de publicação

Em `publish_due()`, chame `requeue_stuck()` no começo, antes da busca por `queued`:

```python
def publish_due() -> None:
    requeue_stuck()
    sb = get_supabase()
    due = (
        sb.table("posts")
        ...
```

Assim cada tick de 1 min primeiro recupera órfãos, depois publica (incluindo os
recém-recuperados, se já vencidos).

**Verify**: `cd image-service && grep -n "requeue_stuck" app/scheduler.py` → 2 matches (def + chamada).

### Step 3: Teste com Supabase mockado

Crie `image-service/tests/test_scheduler.py`. Como o scheduler usa
`get_supabase()`, mocke-o pra capturar a query. Foco: `requeue_stuck` filtra por
`status=publishing` e `updated_at < cutoff`.

```python
"""Testes do scheduler (sem rede; Supabase mockado)."""
from unittest.mock import MagicMock, patch

import app.scheduler as scheduler


def test_requeue_stuck_filters_publishing_and_old():
    sb = MagicMock()
    chain = sb.table.return_value.update.return_value.eq.return_value.lt.return_value
    chain.execute.return_value.data = [{"id": "x"}]

    with patch.object(scheduler, "get_supabase", return_value=sb):
        scheduler.requeue_stuck()

    sb.table.assert_called_with("posts")
    sb.table.return_value.update.assert_called_once()
    update_arg = sb.table.return_value.update.call_args[0][0]
    assert update_arg["status"] == "queued"
    sb.table.return_value.update.return_value.eq.assert_called_with("status", "publishing")
```

**Verify**: `cd image-service && pytest -q tests/test_scheduler.py` → passa.

### Step 4: Suíte completa

**Verify**: `cd image-service && pytest -q` → todos passam.

## Test plan

- Novo: `test_scheduler.py` cobrindo `requeue_stuck` (filtros corretos, update para
  `queued`). Mock do Supabase via `unittest.mock` — sem rede.
- Padrão estrutural: testes Python existentes em `image-service/tests/`.
- Verificação: `pytest -q` → todos passam, incluindo o novo.

## Done criteria

- [ ] `cd image-service && pytest -q` exits 0; `tests/test_scheduler.py` existe e passa
- [ ] `grep -n "requeue_stuck" image-service/app/scheduler.py` → 2 matches (def + chamada em publish_due)
- [ ] `python -c "import app.scheduler"` exit 0
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] Linha de status atualizada em `plans/README.md`

## STOP conditions

Pare e reporte se:
- `posts` não tiver coluna `updated_at` ou o trigger `posts_updated` não existir em
  `supabase/migrations/0001_init.sql` (a recuperação depende de `updated_at` ser
  atualizado na transição pra `publishing`).
- Os excerpts de `scheduler.py` divergirem do código vivo.
- `pytest` falhar duas vezes após correção razoável.

## Maintenance notes

- Se o Plan 005 (claim atômico) landar, `requeue_stuck` continua válido e
  complementar (recupera órfãos; o claim evita duplicidade). Mantenha os dois.
- `STUCK_MINUTES=10` assume que uma publicação normal (com polling de até ~60s) nunca
  passa de 10 min. Se aumentar o timeout de polling em `graph_api.py`, reavalie.
- Reviewer deve checar que `requeue_stuck` roda ANTES da busca por `queued` no tick.
