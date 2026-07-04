# Plan 014: Fechar a corrida entre lote de publicação lento e o requeue de 10 min

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: compare os excerpts de "Current state" com o
> código vivo. Divergência real = STOP.
> `git diff --stat 2db4580..HEAD -- image-service/app/scheduler.py image-service/app/main.py`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (caminho crítico de publicação)
- **Depends on**: plans/013-idempotent-publish.md (rede de segurança contra duplicação)
- **Category**: bug / perf
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

O lote publica **sequencialmente** até 20 posts, e cada um pode bloquear ~60s no
poll do container da Meta → um lote cheio leva até ~20 min. `requeue_stuck`
devolve pra `queued` qualquer post em `publishing` há mais de 10 min
(`STUCK_MINUTES = 10`). Além do APScheduler, o endpoint `/run-due` (chamado pelo
pg_cron a cada minuto quando há post vencido) dispara `publish_due` em
**BackgroundTasks — concorrente** com o job do APScheduler. Resultado: durante
um lote longo, outra passada de `publish_due` roda `requeue_stuck`, "resgata"
posts que ainda estão sendo publicados e os reenfileira — retrabalho garantido
e, sem o plano 013, post duplicado no Instagram.

## Current state

- `image-service/app/scheduler.py:26` — `STUCK_MINUTES = 10`.
- `image-service/app/scheduler.py:48-56` — `publish_due` roda `requeue_stuck()`
  e publica o lote em série:
  ```python
  def publish_due() -> None:
      requeue_stuck()
      sb = get_supabase()
      claimed = sb.rpc("claim_due_posts", {"lim": 20}).execute()
      for post in claimed.data or []:
          _publish_one(sb, post)
  ```
- `image-service/app/publishing/graph_api.py:26-27` — `POLL_INTERVAL = 3`,
  `POLL_MAX_TRIES = 20` (~60s de poll) + `TIMEOUT = 60` por request HTTP.
- `image-service/app/main.py:95-111` — `/run-due` agenda `publish_due` via
  `background_tasks.add_task(publish_due)`: roda em paralelo com o job do
  APScheduler (o claim atômico impede pegar o MESMO post duas vezes, mas não
  impede o `requeue_stuck` de mexer em posts do outro lote).
- `supabase/migrations/0003_claim_posts.sql` — `claim_due_posts` seta
  `updated_at = now()` no claim; `requeue_stuck` filtra por
  `updated_at < now() - STUCK_MINUTES`.
- Padrão de teste: `tests/test_scheduler.py` (MagicMock + patch).

## Commands you will need

| Purpose | Command (rodar em `image-service/`) | Expected on success |
|---------|-------------------------------------|---------------------|
| Testes | `pytest -q` | todos passam |

## Scope

**In scope**:
- `image-service/app/scheduler.py`
- `image-service/tests/test_scheduler.py`

**Out de scope**:
- `graph_api.py` (constantes de poll ficam como estão).
- `main.py` / `/run-due` (o lock de processo abaixo cobre a concorrência dele).
- Migrations (nenhuma mudança de schema).
- Paralelizar o publish com thread pool — melhoria de throughput real, mas
  deferida (ver Maintenance notes); este plano fecha a corrida, que é o bug.

## Git workflow

- Branch atual (`main`), conventional commit, ex.:
  `fix: heartbeat posts in publishing and serialize publish_due runs`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Lock de processo — uma passada de `publish_due` por vez

No topo de `scheduler.py`:

```python
import threading

_publish_lock = threading.Lock()
```

E em `publish_due`:

```python
def publish_due() -> None:
    if not _publish_lock.acquire(blocking=False):
        log.info("publish_due já em execução — pulando esta passada.")
        return
    try:
        requeue_stuck()
        sb = get_supabase()
        claimed = sb.rpc("claim_due_posts", {"lim": 20}).execute()
        for post in claimed.data or []:
            _publish_one(sb, post)
    finally:
        _publish_lock.release()
```

Isso serializa APScheduler × `/run-due` dentro do mesmo processo (o deploy é
single-process; múltiplas réplicas ficam por conta do heartbeat do Step 2).

**Verify**: `pytest -q` → o teste `test_publish_due_uses_atomic_claim` continua
verde (ele chama `publish_due` uma vez; o lock não interfere).

### Step 2: Heartbeat — post em publicação renova `updated_at`

Em `_publish_one`, imediatamente antes de chamar o publisher (depois de montar
`publisher`), tocar o registro para renovar a janela do `requeue_stuck`:

```python
sb.table("posts").update({"updated_at": _now().isoformat()}).eq("id", pid).execute()
```

Como cada publish leva no máx. ~2-3 min (poll 60s + timeouts) e a janela é
10 min, renovar o `updated_at` no INÍCIO de cada item garante que nenhum post
do lote atual cruze o limiar enquanto os anteriores publicam.

**Verify**: `pytest -q` → verde.

### Step 3: Margem extra na janela

Em `scheduler.py:26`, subir `STUCK_MINUTES = 10` → `STUCK_MINUTES = 15`
(folga sobre o pior caso de UM item: poll 60s + 2 requests de 60s + retries do
plano 013). Atualizar o comentário da constante.

**Verify**: `pytest -q` → verde.

### Step 4: Testes novos

Em `tests/test_scheduler.py`:

1. `test_publish_due_skips_when_locked`: adquirir `scheduler._publish_lock`
   manualmente, chamar `publish_due()`, assertar que `sb.rpc` NÃO foi chamado;
   liberar o lock no `finally`.
2. `test_publish_one_heartbeats_updated_at`: com publisher mockado, assertar
   que houve um `update` contendo só `updated_at` antes do publish (inspecionar
   `sb.table.return_value.update.call_args_list`).

**Verify**: `pytest -q` → todos passam, incluindo os novos.

## Test plan

Coberto no Step 4; padrão `tests/test_scheduler.py`. O teste do lock deve usar
`try/finally` para nunca deixar o lock preso entre testes.

## Done criteria

- [ ] `pytest -q` exit 0 com os 2 testes novos
- [ ] `publish_due` usa `threading.Lock` não-bloqueante (grep `_publish_lock`)
- [ ] `_publish_one` renova `updated_at` antes do publish
- [ ] `STUCK_MINUTES == 15`
- [ ] `git status` limpo fora do escopo
- [ ] `plans/README.md` atualizado

## STOP conditions

- Plano 013 ainda não aplicado (cheque `plans/README.md` e a presença do
  curto-circuito por `ig_media_id` em `_publish_one`) — aplicar 013 primeiro.
- Os excerpts de "Current state" não baterem com o código.
- Descobrir que o deploy roda múltiplos workers/processos do uvicorn (o lock é
  por processo) — reporte; a solução multi-réplica é o heartbeat, confirme que
  ele basta antes de inventar lock distribuído.

## Maintenance notes

- **Deferido**: paralelizar `_publish_one` com `ThreadPoolExecutor` (throughput
  1 post/min-worst-case hoje). Quando fizer, o heartbeat por item continua
  válido; o lock passa a proteger só o claim+dispatch.
- Se `POLL_MAX_TRIES`/`TIMEOUT` mudarem em `graph_api.py`, recalcular a folga de
  `STUCK_MINUTES` (regra: janela > pior caso de 1 item × 2).
- Revisor: conferir `finally: release()` — exceção dentro do lote não pode
  deixar o lock preso.
