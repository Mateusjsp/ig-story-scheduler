# Plan 022: Baseline de DX — ruff, typecheck, .env.example, validateStyle, README

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**:
> `git diff --stat 2db4580..HEAD -- .github/workflows/ci.yml web/package.json web/lib/presets.ts README.md`

## Status

- **Priority**: P3
- **Effort**: S (itens independentes; pode parar entre steps)
- **Risk**: LOW
- **Depends on**: none (se o plano 020 mudou o CI, editar sobre a versão dele)
- **Category**: dx / docs
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

Quatro atritos pequenos que pagam juros todo dia: (1) o Python não tem linter —
o código até carrega `# noqa: BLE001` (anotação de Ruff) sem Ruff instalado;
(2) o web não tem `typecheck` dedicado — erro de tipo só aparece no `next build`
lento; (3) não existe `web/.env.example` — onboarding exige engenharia reversa
das rotas para descobrir env vars; (4) `validateStyle` não valida `font`/
`position` nem rejeita chaves desconhecidas, gravando lixo em presets; e o
README descreve o produto pré-editor-de-camadas/pré-feed.

## Current state

- `# noqa: BLE001` presente em `image-service/app/scheduler.py:104`,
  `app/imaging/media.py:17`, `app/imaging/emoji.py:34`, `app/main.py:177` — sem
  nenhuma config de ruff/flake8 no repo; CI python roda só `pytest -q`.
- `web/package.json` scripts: `dev/build/start/lint/test` — sem `typecheck`.
- Env vars do web usadas no código: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (lib/supabase), `IMAGE_SERVICE_URL`,
  `SERVICE_SHARED_SECRET` (rotas de api), `TOKEN_ENC_KEY` (lib/crypto). Só
  existe `image-service/.env.example`; o README (linha 61) até manda copiar
  `web/.env.local.example`, que NÃO existe no repo — instrução quebrada.
- `web/lib/presets.ts:107-115` — `validateStyle` checa hex/ranges mas não
  `font`/`position`; `normalizeStyle` (`:118-125`) espalha `...raw` (chaves
  desconhecidas passam). Tipos válidos no mesmo arquivo: `FontKey` e `Position`
  (ver as declarações no topo do arquivo e `FONT_LABELS`).
- `README.md:87-93` — "Verificação ponta a ponta" descreve upload+legenda
  single-caption; não menciona editor de camadas, crop/zoom, presets, feed
  (4:5/1:1, `feed_caption`), `/reprocess`, edição/cancelamento na Agenda.
- CI: `.github/workflows/ci.yml` (2 jobs, ver arquivo).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Ruff (após instalar) | `ruff check .` (em `image-service/`) | exit 0 |
| Typecheck web | `npx tsc --noEmit` (em `web/`) | exit 0 |
| Testes web | `npm test` (em `web/`) | todos passam |
| Testes python | `pytest -q` (em `image-service/`) | todos passam |

## Scope

**In scope**:
- `image-service/pyproject.toml` (seção `[tool.ruff]`), `image-service/requirements.txt` (dev dep ruff)
- Correções que o ruff apontar em `image-service/app/**` (só as triviais — ver STOP)
- `.github/workflows/ci.yml`
- `web/package.json` (script `typecheck`)
- `web/.env.local.example` (criar)
- `web/lib/presets.ts` + `web/lib/presets.test.ts` (criar/ampliar)
- `README.md`

**Out of scope**:
- Formatador (`ruff format`) — só lint por enquanto (diff de formatação
  poluiria os planos em andamento).
- Reescrever o README inteiro — só a seção de fluxo/verificação e a linha do
  `.env.local.example`.
- pre-commit hooks.

## Git workflow

- Branch atual (`main`); um commit por step (são independentes), ex.:
  `chore: add ruff lint to image-service`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Ruff no image-service

Em `image-service/pyproject.toml`, adicionar:

```toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "W", "BLE", "B", "UP"]
```

Adicionar `ruff>=0.4` na seção Dev/teste do `requirements.txt` (e regenerar o
lock se o plano 020 já foi aplicado). Rodar `ruff check .` e corrigir só
apontamentos triviais (imports não usados, f-strings vazias). No CI, job
`image-service`, adicionar antes dos testes:

```yaml
- name: Lint
  run: ruff check .
```

**Verify**: `ruff check .` → exit 0; `pytest -q` → verde.

### Step 2: Script typecheck no web

Em `web/package.json`: `"typecheck": "tsc --noEmit"`. No CI, job `web`, antes
do build:

```yaml
- name: Typecheck
  run: npm run typecheck
```

**Verify**: `npm run typecheck` → exit 0.

### Step 3: `web/.env.local.example`

Criar (SÓ nomes e placeholders — NUNCA valores reais):

```bash
# Supabase (Project Settings -> API)
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=coloque-a-anon-key
# image-service (mesmo SERVICE_SHARED_SECRET e TOKEN_ENC_KEY do image-service/.env)
IMAGE_SERVICE_URL=http://localhost:8000
SERVICE_SHARED_SECRET=gere-um-segredo
TOKEN_ENC_KEY=gere-com-secrets.token_urlsafe-32
```

Conferir com grep que não faltou var: `grep -rn "process.env." web/app web/lib --include="*.ts" --include="*.tsx" | grep -v NODE_ENV`.

**Verify**: o grep não revela var ausente do example; README linha 61 agora
aponta pra um arquivo que existe.

### Step 4: `validateStyle` completo

Em `web/lib/presets.ts`:

```ts
const FONTS = new Set<FontKey>(["sans-bold", "serif", "condensed", "mono"]);
const POSITIONS = new Set<Position>(["auto", "top", "center", "bottom"]);
```

(Conferir os literais reais dos tipos `FontKey`/`Position` no topo do arquivo —
usar exatamente os do código, não os daqui.) Em `validateStyle`, adicionar:

```ts
if (!FONTS.has(s.font)) return "Fonte inválida";
if (!POSITIONS.has(s.position)) return "Posição inválida";
```

Em `normalizeStyle`, construir por allowlist em vez de spread:

```ts
return {
  font: raw?.font ?? DEFAULT_STYLE.font,
  text_color: raw?.text_color ?? DEFAULT_STYLE.text_color,
  position: raw?.position ?? DEFAULT_STYLE.position,
  size_factor: raw?.size_factor ?? DEFAULT_STYLE.size_factor,
  scrim: { ...DEFAULT_STYLE.scrim, ...raw?.scrim },
  outline: { ...DEFAULT_STYLE.outline, ...raw?.outline },
};
```

(Ajustar à lista REAL de campos de `StyleConfig`.) Testes em
`web/lib/presets.test.ts`: font inválida → erro; position inválida → erro;
chave estranha em `raw` não aparece no normalizado.

**Verify**: `npm test` → verde; `npm run typecheck` → exit 0.

### Step 5: README atualizado

Atualizar em `README.md`:
- Linha do fluxo (~19) e "Verificação ponta a ponta" (~87-93): mencionar editor
  de camadas (texto/emoji/crop-zoom), presets, destino Story vs Feed (9:16 /
  4:5 / 1:1, `feed_caption`), edição/cancelamento pela Agenda (reprocesso).
- Corrigir o nome do arquivo de env se necessário (Step 3).

**Verify**: leitura; os comandos citados no README existem
(`npm run typecheck` incluído).

## Test plan

- `presets.test.ts` (Step 4) — 3+ casos novos.
- Demais steps verificados por comando (ruff/tsc/grep).

## Done criteria

- [ ] `ruff check .` exit 0 e presente no CI
- [ ] `npm run typecheck` exit 0 e presente no CI
- [ ] `web/.env.local.example` cobre todas as vars do grep
- [ ] `validateStyle` rejeita font/position inválidas (teste prova)
- [ ] README sem instruções quebradas (env example, fluxo atual)
- [ ] `pytest -q` e `npm test` verdes
- [ ] `plans/README.md` atualizado

## STOP conditions

- Ruff apontar problema NÃO-trivial (bug real, bare-except mascarando erro) —
  liste no relatório e NÃO conserte aqui (vira achado novo).
- `tsc --noEmit` falhar em código existente — reporte os erros em vez de
  "consertar" às pressas (podem revelar bug real).
- Os literais de `FontKey`/`Position` divergirem dos exemplos do Step 4 — use
  os do código; se o tipo não existir mais, drift → reporte.

## Maintenance notes

- Com ruff no CI, os `# noqa: BLE001` passam a ser honrados de verdade —
  remover os que o ruff não exigir.
- Var de ambiente nova ⇒ atualizar `.env.local.example` no mesmo PR (revisor:
  cobrar isso).
- Follow-up deferido: `ruff format` + formatação única do repo Python.
