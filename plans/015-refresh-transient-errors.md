# Plan 015: Não marcar conta como `token_expired` em erro transitório de refresh

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: compare os excerpts de "Current state" com o
> código vivo. Se o plano 011 já tiver sido aplicado, o `except` terá
> `_safe_err(exc)` no log — isso é esperado, não é drift. Divergência real = STOP.
> `git diff --stat 2db4580..HEAD -- image-service/app/scheduler.py`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (compõe bem com o 011, que mexe no mesmo trecho)
- **Category**: bug
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

O job de refresh (12/12h) marca a conta como `token_expired` em **qualquer**
exceção — timeout, DNS, 5xx da Meta, JSON inesperado. Conta `token_expired` sai
do refresh (o job filtra `status = 'active'`) e o produto passa a exigir que o
usuário reconecte o Instagram. Ou seja: um blip de rede de 1 segundo vira uma
interrupção real de serviço para o cliente, sem necessidade — o token continua
válido e o próximo ciclo teria funcionado.

## Current state

- `image-service/app/scheduler.py:124-147` — o `except` único demove a conta
  incondicionalmente:
  ```python
  for acc in rows.data or []:
      try:
          token = decrypt_token(acc["access_token_enc"])
          ...
          resp = requests.get(f"{host}/refresh_access_token", params={...}, timeout=60)
          resp.raise_for_status()
          data = resp.json()
          ...
      except Exception as exc:  # noqa: BLE001
          sb.table("ig_accounts").update({"status": "token_expired"}).eq(
              "id", acc["id"]
          ).execute()
          log.warning("refresh da conta %s falhou: %s", acc["id"], exc)
  ```
- O job seleciona contas com `status = 'active'` e
  `token_expires_at <= agora+7d` (`scheduler.py:113-123`) e roda a cada 12h
  (`scheduler.py:157`) — ou seja, há ~14 oportunidades de retry natural antes do
  token expirar de verdade; demover na primeira falha é desnecessário.
- Semântica de erro: token realmente inválido/revogado = a Meta responde
  **4xx** (400/401/403). 5xx e exceções de transporte (`requests.RequestException`
  sem `response`) são transitórios.
- Enum de status: `active | token_expired | revoked`
  (`supabase/migrations/0001_init.sql`).

## Commands you will need

| Purpose | Command (rodar em `image-service/`) | Expected on success |
|---------|-------------------------------------|---------------------|
| Testes | `pytest -q` | todos passam |

## Scope

**In scope**:
- `image-service/app/scheduler.py` (só a função `refresh_tokens`)
- `image-service/tests/test_scheduler.py`

**Out of scope**:
- `publish_due`/`_publish_one` (planos 013/014).
- Webhook de deauthorização da Meta (item de direção, plano 008).

## Git workflow

- Branch atual (`main`), conventional commit, ex.:
  `fix: only demote account on authoritative 4xx token rejection`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Classificar o erro antes de demover

Reescrever o `except` de `refresh_tokens`:

```python
except Exception as exc:  # noqa: BLE001
    resp_status = getattr(getattr(exc, "response", None), "status_code", None)
    if resp_status is not None and 400 <= resp_status < 500:
        # A Meta rejeitou o token: expirado/revogado de verdade.
        sb.table("ig_accounts").update({"status": "token_expired"}).eq(
            "id", acc["id"]
        ).execute()
        log.warning("refresh da conta %s: token rejeitado (HTTP %s)", acc["id"], resp_status)
    else:
        # Transitório (rede/5xx/parse): mantém active; o job de 12h tenta de novo.
        log.warning("refresh da conta %s falhou (transitório): %s", acc["id"], exc)
```

Notas:
- `requests.HTTPError` (de `raise_for_status`) carrega `exc.response`; erros de
  transporte não têm `response` → caem no ramo transitório.
- Erro de `decrypt_token` (chave errada) também cai no transitório — correto:
  não é o token da Meta que expirou; aparece no log para investigação.
- Se o plano 011 já foi aplicado, use `_safe_err(exc)` no log em vez de `exc`.

**Verify**: `pytest -q` → verde.

### Step 2: Testes

Em `tests/test_scheduler.py`, padrão MagicMock existente, mockando
`requests.get` via `patch.object(scheduler.requests, "get", ...)`:

1. `test_refresh_transient_error_keeps_active`: `requests.get` levanta
   `requests.ConnectionError()` → NENHUM update com `status="token_expired"`.
2. `test_refresh_4xx_demotes_account`: resposta com `status_code=400` e
   `raise_for_status` levantando `requests.HTTPError(response=resp_mock)` →
   update com `status="token_expired"`.
3. `test_refresh_5xx_keeps_active`: `HTTPError` com `response.status_code=500`
   → nenhum demote.

**Verify**: `pytest -q` → todos passam, incluindo os 3 novos.

## Test plan

Coberto no Step 2. Para o mock do `HTTPError`:
`err = requests.HTTPError(); err.response = MagicMock(status_code=400)` e usar
`resp.raise_for_status.side_effect = err`.

## Done criteria

- [ ] `pytest -q` exit 0 com os 3 testes novos
- [ ] `token_expired` só é gravado quando `exc.response.status_code` ∈ 4xx
- [ ] `git status` limpo fora do escopo
- [ ] `plans/README.md` atualizado

## STOP conditions

- Os excerpts não baterem com o código (além do delta esperado do plano 011).
- Descobrir que a Meta sinaliza token inválido com algo diferente de 4xx no
  `/refresh_access_token` (ex.: 200 com corpo de erro) — pare e reporte com a
  evidência.

## Maintenance notes

- Melhoria futura possível: contador de falhas consecutivas (ex.: demover após
  N transitórios seguidos com token já vencido) — desnecessário enquanto a
  janela de refresh é 7 dias com ciclo de 12h.
- Revisor: conferir que o ramo transitório NÃO faz update nenhum na conta.
