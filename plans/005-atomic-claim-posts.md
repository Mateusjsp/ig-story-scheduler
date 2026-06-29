# Plan 005: Reivindicar posts atomicamente (evitar publicação dupla)

> **Executor instructions**: Siga passo a passo, rode cada verificação, STOP nas
> condições. Ao fim, atualize `plans/README.md`.
>
> **Drift check**: monorepo **não-commitado** (working tree `main`, HEAD `bc4230d`).
> Compare excerpts com o código vivo; divergência = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/004-orphaned-publishing-recovery.md (mesma área do scheduler; faça 004 antes)
- **Category**: bug
- **Planned at**: working tree em `main` (HEAD `bc4230d`, não-commitado), 2026-06-29

## Why this matters

`publish_due()` faz **SELECT** dos posts `queued` vencidos e depois **UPDATE** um a um.
Entre o select e o update não há atomicidade: se o image-service rodar com **mais de uma
instância** (réplicas no Railway/Render, ou um deploy sobreposto), duas instâncias
selecionam o MESMO post e ambas publicam → **Story duplicado** na conta do usuário. A
correção padrão em Postgres é reivindicar (claim) as linhas atomicamente com
`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`, exposto como uma
função RPC que o scheduler chama. Cada post é reivindicado por exatamente uma instância.

## Current state

- `image-service/app/scheduler.py` — `publish_due()` (excerpt):

```python
def publish_due() -> None:
    requeue_stuck()  # (presente após o Plan 004)
    sb = get_supabase()
    due = (
        sb.table("posts")
        .select(
            "id, attempts, media:media_id(processed_url),"
            " account:account_id(ig_user_id, access_token_enc, graph_host)"
        )
        .eq("status", "queued")
        .lte("scheduled_at", _now().isoformat())
        .limit(20)
        .execute()
    )
    for post in due.data or []:
        _publish_one(sb, post)
```

- `_publish_one()` já seta `status='publishing'` no início. Com o claim atômico, a
  transição pra `publishing` passa a acontecer DENTRO do claim (no SQL), então
  `_publish_one` não deve mais re-setar `publishing` (evita update redundante) — ver Step 3.
- Migrations existentes: `supabase/migrations/0001_init.sql`, `0002_storage.sql`. Padrão:
  SQL puro, comentários em PT, nomes snake_case. A tabela `posts` tem colunas
  `status post_status`, `scheduled_at`, `attempts`, `updated_at`, e o índice parcial
  `posts_due_idx on posts(scheduled_at) where status = 'queued'`.
- O scheduler usa o client Supabase service-role (`app/db.py:get_supabase()`), que
  expõe `.rpc(name, params)`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Testes do serviço | `cd image-service && pytest -q` | todos passam |
| Import sanity | `cd image-service && python -c "import app.scheduler"` | exit 0 |
| Validar SQL (manual) | aplicar `0003_claim_posts.sql` no Supabase (SQL Editor) | sem erro |

## Scope

**In scope:**
- `supabase/migrations/0003_claim_posts.sql` (criar)
- `image-service/app/scheduler.py`
- `image-service/tests/test_scheduler.py` (estender — criado no Plan 004)

**Out of scope (NÃO tocar):**
- `0001_init.sql`, `0002_storage.sql` — migrations já aplicadas; nunca edite migration
  existente, sempre crie uma nova.
- `requeue_stuck` (Plan 004) — permanece como está.
- `graph_api.py` — publicação inalterada.

## Git workflow

- Branch: `advisor/005-atomic-claim-posts`
- Commits conventional.
- Sem push/PR salvo instrução.

## Steps

### Step 1: Migration com a função de claim

Crie `supabase/migrations/0003_claim_posts.sql`:

```sql
-- Reivindica atomicamente até `lim` posts vencidos, marcando-os 'publishing'.
-- FOR UPDATE SKIP LOCKED garante que instâncias concorrentes nunca pegam o mesmo post.
create or replace function claim_due_posts(lim int default 20)
returns setof posts
language sql
as $$
  update posts p
  set status = 'publishing', attempts = p.attempts + 1, updated_at = now()
  where p.id in (
    select id from posts
    where status = 'queued' and scheduled_at <= now()
    order by scheduled_at
    for update skip locked
    limit lim
  )
  returning p.*;
$$;
```

**Verify** (manual, exige Supabase configurado): rode o conteúdo no SQL Editor do
Supabase → "Success. No rows returned". Se não houver acesso ao Supabase neste momento,
pule a verificação e marque no relatório que a migration precisa ser aplicada manualmente.

### Step 2: Scheduler usa o claim em vez de select+update

Em `publish_due()`, troque o bloco `due = sb.table("posts").select(...)...` por uma
chamada RPC. O `claim_due_posts` retorna as linhas de `posts` (com `id, account_id,
media_id, attempts` etc.), mas SEM os embeds de `media`/`account`. Então, para cada
post reivindicado, busque os dados relacionados antes de publicar:

```python
def publish_due() -> None:
    requeue_stuck()
    sb = get_supabase()
    claimed = sb.rpc("claim_due_posts", {"lim": 20}).execute()
    for post in claimed.data or []:
        _publish_one(sb, post)
```

### Step 3: `_publish_one` busca relacionados e não re-marca publishing

O claim já setou `status='publishing'` e incrementou `attempts`. Ajuste `_publish_one`
para (a) NÃO repetir esse update inicial, e (b) buscar `media.processed_url` e os
campos da conta a partir dos ids do post:

```python
def _publish_one(sb, post: dict) -> None:
    pid = post["id"]
    try:
        media = (
            sb.table("media").select("processed_url").eq("id", post["media_id"]).single().execute().data
        )
        account = (
            sb.table("ig_accounts")
            .select("ig_user_id, access_token_enc, graph_host")
            .eq("id", post["account_id"])
            .single()
            .execute()
            .data
        )
        image_url = (media or {}).get("processed_url")
        if not image_url:
            raise RuntimeError("media sem processed_url (rode o /process antes).")
        token = decrypt_token(account["access_token_enc"])
        publisher = GraphApiPublisher(
            ig_user_id=account["ig_user_id"],
            access_token=token,
            graph_host=account.get("graph_host") or "https://graph.instagram.com",
        )
        ig_media_id = publisher.publish_story(image_url)
        sb.table("posts").update(
            {"status": "published", "ig_media_id": ig_media_id,
             "published_at": _now().isoformat(), "error": None}
        ).eq("id", pid).execute()
        log.info("post %s publicado (%s)", pid, ig_media_id)
    except Exception as exc:  # noqa: BLE001
        attempts = post.get("attempts", 0)
        status = "queued" if attempts < MAX_ATTEMPTS else "failed"
        sb.table("posts").update({"status": status, "error": str(exc)}).eq("id", pid).execute()
        log.warning("post %s falhou (%s/%s): %s", pid, attempts, MAX_ATTEMPTS, exc)
```

Note: `attempts` já foi incrementado pelo claim, então o retry usa `post["attempts"]`
direto (sem `+1`).

**Verify**: `cd image-service && python -c "import app.scheduler"` → exit 0.
`grep -n "claim_due_posts" image-service/app/scheduler.py` → 1 match.
`grep -n '"status": "publishing"' image-service/app/scheduler.py` → 0 matches (o claim
faz isso no SQL agora; `requeue_stuck` usa `.eq("status","publishing")` que é filtro, não
update-pra-publishing — confirme que o único lugar que SETA publishing some do Python).

### Step 4: Atualizar o teste do scheduler

Em `image-service/tests/test_scheduler.py`, adicione um teste que `publish_due` chama o
RPC `claim_due_posts` (mockando `get_supabase`):

```python
def test_publish_due_uses_atomic_claim():
    sb = MagicMock()
    sb.rpc.return_value.execute.return_value.data = []
    with patch.object(scheduler, "get_supabase", return_value=sb), \
         patch.object(scheduler, "requeue_stuck"):
        scheduler.publish_due()
    sb.rpc.assert_called_with("claim_due_posts", {"lim": 20})
```

**Verify**: `cd image-service && pytest -q tests/test_scheduler.py` → passa.

### Step 5: Suíte completa

**Verify**: `cd image-service && pytest -q` → todos passam.

## Test plan

- Estender `test_scheduler.py`: `publish_due` usa `rpc("claim_due_posts", ...)`.
- (Recuperação `requeue_stuck` do Plan 004 segue testada.)
- A garantia de SKIP LOCKED é do Postgres; o teste unitário verifica que o Python chama
  o caminho atômico (não dá pra testar concorrência real sem DB). A migration é validada
  manualmente no SQL Editor.
- Verificação: `pytest -q` → todos passam.

## Done criteria

- [ ] `supabase/migrations/0003_claim_posts.sql` existe com `claim_due_posts` usando `for update skip locked`
- [ ] `cd image-service && pytest -q` exits 0; teste do claim passa
- [ ] `grep -n "claim_due_posts" image-service/app/scheduler.py` → 1 match
- [ ] `grep -n '"status": "publishing"' image-service/app/scheduler.py` → 0 matches
- [ ] Migrations `0001`/`0002` **inalteradas** (`git status`)
- [ ] Linha de status atualizada em `plans/README.md`

## STOP conditions

Pare e reporte se:
- O Plan 004 ainda NÃO landou (este plano assume `requeue_stuck` presente e o
  `publish_due` chamando-o). Se `requeue_stuck` não existir, PARE — faça o 004 primeiro.
- O retorno de `claim_due_posts` no `supabase-py` não vier como lista de dicts com
  `id`/`media_id`/`account_id` (verifique com um teste manual); se o shape divergir,
  reporte antes de adaptar.
- Os excerpts divergirem do código vivo.

## Maintenance notes

- A função RPC roda com os privilégios do caller; como o scheduler usa service-role, ok.
  Se um dia o painel (anon/RLS) precisar chamar, reavalie `security definer` + grants.
- Se adicionar prioridade/ordenação custom na fila, ajuste o `order by` dentro do claim.
- Reviewer deve confirmar: (a) `attempts` não é incrementado duas vezes (claim já soma 1);
  (b) nenhum caminho Python seta `publishing` (só o SQL); (c) a migration é nova, não edita as antigas.
