# Plan 020: Lockfile para as dependências Python (build reproduzível)

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**:
> `git diff --stat 2db4580..HEAD -- image-service/requirements.txt .github/workflows/ci.yml image-service/Dockerfile`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dependencies / dx
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

`image-service/requirements.txt` usa só limites inferiores (`Pillow>=10.0`,
`numpy>=1.26`, `opencv-python-headless>=4.8`, `supabase>=2.4`...). Cada CI run e
cada deploy resolve versões diferentes das testadas — um minor quebrado de
Pillow/numpy muda o RENDER (pixel-level, o coração do produto) sem nenhum diff
no repo. O web já faz certo (`package-lock.json` + `npm ci`); o Python precisa
do equivalente.

## Current state

- `image-service/requirements.txt` — todas as deps com `>=`, incluindo dev
  (`pytest>=8.0`, `httpx>=0.27`) misturadas com runtime.
- `.github/workflows/ci.yml`, job `image-service`:
  ```yaml
  - name: Instalar deps
    run: pip install -r requirements.txt
  ```
- `image-service/Dockerfile` — (conferir: instala de `requirements.txt`).
- `image-service/pyproject.toml` — só config de pytest, sem metadata de projeto.
- Ferramenta escolhida: **pip-tools** (`pip-compile`) — menor mudança possível,
  mantém `requirements.txt` como fonte e gera `requirements.lock`. (uv/Poetry
  seriam migrações maiores; fora de escopo.)

## Commands you will need

| Purpose | Command (rodar em `image-service/`, venv ativo) | Expected on success |
|---------|--------------------------------------------------|---------------------|
| Instalar pip-tools | `pip install pip-tools` | exit 0 |
| Gerar lock | `pip-compile requirements.txt -o requirements.lock --strip-extras` | cria `requirements.lock` |
| Sync local | `pip-sync requirements.lock` (opcional) | exit 0 |
| Testes | `pytest -q` | todos passam |

## Scope

**In scope**:
- `image-service/requirements.lock` (criar, commitar)
- `.github/workflows/ci.yml` (job image-service instala do lock)
- `image-service/Dockerfile` (instalar do lock)
- `README.md` (uma linha no setup: como regenerar o lock)

**Out of scope**:
- Migrar para uv/Poetry/pyproject completo.
- Atualizar versões das deps (o lock congela o que resolver hoje; upgrades são
  outra tarefa).
- Separar dev-deps de runtime (nice-to-have; anotar como follow-up).

## Git workflow

- Branch atual (`main`), conventional commit, ex.:
  `build: lock python dependencies with pip-tools`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Gerar o lock

Em `image-service/` (venv Python 3.12 — mesma versão do CI):

```
pip install pip-tools
pip-compile requirements.txt -o requirements.lock --strip-extras
```

**Verify**: `requirements.lock` existe e contém versões pinadas (`==`) com
comentários de origem (`# via ...`).

### Step 2: Validar que o lock funciona

```
pip-sync requirements.lock
pytest -q
```

**Verify**: `pytest -q` → todos passam com as versões pinadas.

### Step 3: CI instala do lock

Em `.github/workflows/ci.yml`, job `image-service`:

```yaml
- name: Instalar deps
  run: pip install -r requirements.lock
```

**Verify**: YAML válido (`python -c "import yaml, io; yaml.safe_load(io.open('.github/workflows/ci.yml', encoding='utf-8'))"` na raiz, se PyYAML disponível; senão inspeção visual).

### Step 4: Dockerfile instala do lock

Em `image-service/Dockerfile`, trocar a linha de install para usar
`requirements.lock` (copiar o lock no lugar de/além do requirements.txt).

**Verify**: leitura do diff (build de imagem é opcional; se Docker disponível,
`docker build image-service/` → sucesso).

### Step 5: Documentar

No `README.md` raiz, seção do image-service, adicionar:

```
# Atualizar deps: edite requirements.txt e rode
pip-compile requirements.txt -o requirements.lock --strip-extras
```

**Verify**: linha presente.

## Test plan

Sem testes novos — a verificação é `pytest -q` com o ambiente sincronizado ao
lock (Step 2).

## Done criteria

- [ ] `image-service/requirements.lock` commitado, tudo com `==`
- [ ] CI e Dockerfile instalam do lock
- [ ] `pytest -q` exit 0 no ambiente sincronizado
- [ ] README documenta a regeneração
- [ ] `plans/README.md` atualizado

## STOP conditions

- `pip-compile` falhar por conflito de resolução — reporte o conflito exato em
  vez de relaxar bounds no requirements.txt.
- `pytest` falhar com as versões pinadas (indicaria que o ambiente local atual
  difere do resolvido) — reporte quais pacotes divergem (`pip list`).
- Dockerfile tiver estrutura inesperada (multi-stage com outro mecanismo) —
  adapte se óbvio; senão reporte.

## Maintenance notes

- Upgrades de dep agora são explícitos: editar requirements.txt (ou
  `pip-compile --upgrade-package Pillow`) e re-gerar o lock — o diff do lock é o
  changelog.
- Follow-up deferido: `requirements-dev.txt` separado (pytest/httpx fora da
  imagem de produção).
- Revisor: conferir que o CI não instala mais do requirements.txt solto.
