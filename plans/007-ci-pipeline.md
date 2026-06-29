# Plan 007: Pipeline de CI (pytest + build/lint do web)

> **Executor instructions**: Siga passo a passo, rode cada verificação, STOP nas
> condições. Ao fim, atualize `plans/README.md`.
>
> **Drift check**: monorepo **não-commitado** (working tree `main`, HEAD `bc4230d`).
> Compare excerpts/comandos com o repo vivo; divergência = STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (mas se rodar APÓS o Plan 003, o passo de teste do web pega o vitest automaticamente via `--if-present`)
- **Category**: dx
- **Planned at**: working tree em `main` (HEAD `bc4230d`, não-commitado), 2026-06-29

## Why this matters

Não há CI. O workflow antigo do GitHub Actions (publicação do CLI) foi removido na
migração pra monorepo e nada o substituiu. Hoje nada impede que um commit quebre o
`pytest` do image-service ou o `npm run build` do web. Um pipeline mínimo que roda os
dois em cada push/PR transforma "quebrou e ninguém viu" em "PR vermelho". Este plano
adiciona um workflow com dois jobs (Python e Node) usando exatamente os comandos de
verificação que já funcionam local.

## Current state

- **Não existe** `.github/` no repo (foi removido na migração). Confirme com
  `ls -la .github 2>/dev/null` → não existe.
- Estrutura do monorepo (raiz): `web/`, `image-service/`, `supabase/`, `plans/`.
- **image-service**: Python 3.12. Testes: `cd image-service && pytest -q` (config em
  `image-service/pyproject.toml`, `pythonpath=["."]`). Deps em
  `image-service/requirements.txt`. O `opencv-python-headless` exige a lib de sistema
  `libglib2.0-0` no Ubuntu (ver `image-service/Dockerfile`, que instala exatamente isso).
- **web**: Node 20, Next 16. Comandos: `cd web && npm ci`, `npm run lint`, `npm run build`.
  Script `test` só existe se o Plan 003 tiver landado (use `npm test --if-present`).
- Os testes do image-service NÃO precisam de Supabase real (imports lazy); rodam só com
  as deps instaladas.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Testes Python (local) | `cd image-service && pip install -r requirements.txt && pytest -q` | passam |
| Build web (local) | `cd web && npm ci && npm run build` | exit 0 |
| Lint YAML (opcional) | `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` | exit 0 |

## Scope

**In scope:**
- `.github/workflows/ci.yml` (criar)

**Out of scope (NÃO tocar):**
- Qualquer código de `web/` ou `image-service/` — CI não deve exigir mudança de código.
- Deploy/publish (Vercel/Railway têm seus próprios gatilhos) — este workflow é só
  verificação, não faz deploy.
- Segredos/variáveis de ambiente — os testes não precisam de Supabase real; NÃO
  configure secrets aqui.

## Git workflow

- Branch: `advisor/007-ci-pipeline`
- Commit conventional (ex.: `ci: adiciona pipeline de testes e build`).
- Sem push/PR salvo instrução.

## Steps

### Step 1: Criar o workflow

Crie `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  image-service:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: image-service
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Lib de sistema do OpenCV
        run: sudo apt-get update && sudo apt-get install -y libglib2.0-0
      - name: Instalar deps
        run: pip install -r requirements.txt
      - name: Testes
        run: pytest -q

  web:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: web/package-lock.json
      - name: Instalar deps
        run: npm ci
      - name: Lint
        run: npm run lint
      - name: Testes (se existirem)
        run: npm test --if-present
      - name: Build
        run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder-anon-key
```

> As envs no build são placeholders só pra satisfazer a criação do client Supabase no
> build (as rotas são dinâmicas; nenhuma chamada de rede roda no build). Espelham o que
> `web/.env.local.example` documenta.

**Verify**: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"` → `yaml ok`.

### Step 2: Conferir os comandos localmente (espelho do CI)

Rode o que o CI vai rodar, pra garantir que passa:

**Verify**:
- `cd image-service && pip install -r requirements.txt && pytest -q` → todos passam.
- `cd web && npm ci && npm run lint && npm run build` → exit 0 (com as envs placeholder
  já presentes em `web/.env.local`, ou exporte-as como no workflow).

## Test plan

- Não há "testes" novos de código — o entregável É o pipeline. A validação é: o YAML é
  válido e os comandos do workflow passam quando rodados localmente.
- Após push (quando o operador autorizar), confirmar que os dois jobs ficam verdes no
  GitHub Actions.

## Done criteria

- [ ] `.github/workflows/ci.yml` existe e é YAML válido
- [ ] Rodando local: `cd image-service && pytest -q` passa
- [ ] Rodando local: `cd web && npm run build` exit 0
- [ ] O workflow tem dois jobs: `image-service` e `web`
- [ ] Nenhum arquivo de código (`web/`, `image-service/`) modificado (`git status`)
- [ ] Linha de status atualizada em `plans/README.md`

## STOP conditions

Pare e reporte se:
- `.github/` já existir com um workflow conflitante (não sobrescreva sem reportar).
- `pytest` ou `npm run build` falharem local — o CI só deve ser adicionado sobre uma
  base verde; se algo já está quebrado, reporte (não é deste plano consertar código).

## Maintenance notes

- Quando o Plan 003 landar, `npm test --if-present` passa a rodar o vitest sem mudança no
  workflow.
- Se adicionarem deps de sistema novas ao image-service, espelhe no step de apt-get (ou
  considere rodar o job dentro do `image-service/Dockerfile` no futuro).
- Reviewer deve checar que nenhum segredo real foi adicionado ao workflow (só placeholders).
