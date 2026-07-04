# Plan 011: Impedir que o access token do Instagram vaze em logs e em `posts.error`

> **Executor instructions**: Siga passo a passo. Rode cada comando de verificação
> e confirme o resultado esperado antes do próximo passo. Se qualquer condição de
> "STOP conditions" ocorrer, pare e reporte — não improvise. Ao terminar, atualize
> a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: compare os excerpts de "Current state" com o
> código vivo (o working tree pode ter mudanças não commitadas). Divergência real
> = STOP.
> `git diff --stat 2db4580..HEAD -- image-service/app/scheduler.py image-service/app/publishing/graph_api.py`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

O token de acesso do Instagram (60 dias, cifrado AES-256-GCM no banco) é passado
como **query string** em dois GETs. A biblioteca `requests` inclui a URL completa
na mensagem das exceções (`HTTPError` de `raise_for_status`, `ConnectTimeout`,
etc.). Essas mensagens são logadas (`log.warning`) e, no fluxo de publicação,
gravadas em texto puro na coluna `posts.error` — que a UI mostra ao usuário e
fica persistida. Ou seja: qualquer 4xx/5xx ou erro transitório de rede pode
escrever um token vivo em log/banco, anulando a proteção da cifragem em repouso.

## Current state

- `image-service/app/scheduler.py:128-133` — refresh de token com token na URL e
  `raise_for_status()` (a exceção carrega a URL inteira):
  ```python
  resp = requests.get(
      f"{host}/refresh_access_token",
      params={"grant_type": "ig_refresh_token", "access_token": token},
      timeout=60,
  )
  resp.raise_for_status()
  ```
  A exceção cai em `scheduler.py:143-147` e é logada:
  `log.warning("refresh da conta %s falhou: %s", acc["id"], exc)`.
- `image-service/app/publishing/graph_api.py:80-84` — poll de status do container
  com token em `params`. Uma exceção de rede do `requests` (Timeout,
  ConnectionError) levantada **antes** de `_raise_for_meta_error` carrega a URL
  com o token e propaga até `scheduler.py:104-110`, onde é persistida:
  ```python
  except Exception as exc:  # noqa: BLE001
      ...
      sb.table("posts").update({"status": status, "error": str(exc)}).eq("id", pid).execute()
      log.warning("post %s falhou (%s/%s): %s", pid, attempts, MAX_ATTEMPTS, exc)
  ```
- Os POSTs (`_create_container`, `_publish_container`,
  `graph_api.py:69-73/95-99`) já mandam o token no **body** (`data=`) — esse é o
  padrão certo; `requests` não põe body em mensagens de exceção.
- `_raise_for_meta_error` (`graph_api.py:103-113`) já produz mensagens limpas
  (só `message`/`code` da Meta) — o problema são as exceções que nascem no
  próprio `requests`.
- A API da Meta aceita `access_token` tanto em query quanto em body para POSTs;
  para GETs de leitura (`/refresh_access_token`, status do container), aceita o
  header `Authorization: Bearer <token>`.

## Commands you will need

| Purpose | Command (rodar em `image-service/`) | Expected on success |
|---------|-------------------------------------|---------------------|
| Testes | `pytest -q` | todos passam (hoje: 40) |
| Grep de regressão | `grep -rn "access_token" app/ --include="*.py"` | nenhuma ocorrência dentro de `params={...}` |

## Scope

**In scope**:
- `image-service/app/scheduler.py`
- `image-service/app/publishing/graph_api.py`
- `image-service/tests/test_publishing.py`, `image-service/tests/test_scheduler.py` (ajustar/adicionar testes)

**Out of scope**:
- `web/` — o token nunca chega ao browser.
- Mudar o formato/cifragem do token.
- Rotação dos tokens já existentes (ação operacional — ver Maintenance notes).

## Git workflow

- Branch atual (`main`), conventional commit, ex.:
  `fix: keep access token out of URLs, logs and posts.error`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Token via header nos GETs

Em `graph_api.py`, no `_wait_until_ready`, remover `access_token` de `params` e
mandar via header:

```python
resp = requests.get(
    url,
    params={"fields": "status_code"},
    headers={"Authorization": f"Bearer {self.access_token}"},
    timeout=TIMEOUT,
)
```

Em `scheduler.py` (`refresh_tokens`), idem:

```python
resp = requests.get(
    f"{host}/refresh_access_token",
    params={"grant_type": "ig_refresh_token"},
    headers={"Authorization": f"Bearer {token}"},
    timeout=60,
)
```

**Verify**: `pytest -q` → o teste existente de poll
(`tests/test_publishing.py`) pode falhar se assertar `params` — ajustar o teste
para o novo shape (token no header, não em params).

### Step 2: Sanitizar o que vai pra `posts.error` e pro log

Em `scheduler.py`, adicionar um helper no topo do módulo:

```python
def _safe_err(exc: Exception) -> str:
    """Mensagem de erro sem URL/token (exceções do requests embutem a URL)."""
    if isinstance(exc, requests.RequestException):
        return f"{type(exc).__name__} ao chamar a API da Meta"
    return str(exc)
```

E usar nos dois pontos:
- `_publish_one` except: `"error": _safe_err(exc)` e
  `log.warning(..., _safe_err(exc))`.
- `refresh_tokens` except: `log.warning("refresh da conta %s falhou: %s", acc["id"], _safe_err(exc))`.

Nota: os `RuntimeError` de `_raise_for_meta_error` não são `RequestException`,
então a mensagem limpa da Meta continua chegando ao usuário — só as exceções de
transporte são genéricas.

**Verify**: `pytest -q` → verde.

### Step 3: Teste de regressão

Em `tests/test_scheduler.py`, adicionar teste no padrão dos existentes (mock de
`get_supabase` + `patch`): simular `_publish_one` com publisher que levanta
`requests.ConnectTimeout("... access_token=SECRETO ...")` e assertar que o
`update` gravou `error` **sem** conter `SECRETO`. Em `tests/test_publishing.py`,
assertar que o GET de status não tem `access_token` em `params` e tem o header
`Authorization`.

**Verify**: `pytest -q` → todos passam, incluindo os novos.

## Test plan

- `tests/test_publishing.py`: GET de status usa header Bearer, `params` só com
  `fields`.
- `tests/test_scheduler.py`: (a) erro de transporte → `posts.error` genérico sem
  token; (b) erro da Meta (`RuntimeError` do `_raise_for_meta_error`) → mensagem
  preservada.
- Padrão estrutural: seguir `tests/test_scheduler.py` (MagicMock em cadeia +
  `patch.object(scheduler, "get_supabase", ...)`).

## Done criteria

- [ ] `pytest -q` exit 0, com os novos testes
- [ ] `grep -n "access_token" image-service/app/publishing/graph_api.py image-service/app/scheduler.py` não mostra token dentro de `params={...}`
- [ ] `posts.error` recebe mensagem sanitizada em erro de transporte (teste prova)
- [ ] `git status` limpo fora do escopo
- [ ] `plans/README.md` atualizado

## STOP conditions

- O endpoint da Meta rejeitar `Authorization: Bearer` em teste real (o plano
  assume que aceita; se um teste manual contra a API real falhar com 401 **só**
  por causa do header, volte o token para `params` apenas naquele GET e mantenha
  a sanitização do Step 2 — e reporte).
- Os excerpts de "Current state" não baterem com o código.
- Algum teste existente falhar por motivo não relacionado ao seu diff.

## Maintenance notes

- **Operacional (humano)**: tokens que já apareceram em logs/`posts.error` devem
  ser considerados queimados — reconectar as contas afetadas (gera token novo) e
  limpar valores antigos de `posts.error` se contiverem URLs.
- Revisor: conferir que nenhum log novo interpola `exc` cru no caminho de
  publicação/refresh.
- Se um dia adotarem logging estruturado (ver achado de DX), aplicar um filtro
  de redação central em vez do helper local.
