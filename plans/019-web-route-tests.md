# Plan 019: Testes de caracterização das rotas de API do web (fila de publicação)

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: os planos 010, 012, 016 e 018 mexem nas
> mesmas rotas — se já aplicados, os testes daqui devem cobrir o comportamento
> NOVO deles (as guardas). Compare os excerpts com o código vivo antes de
> escrever asserções.
> `git diff --stat 2db4580..HEAD -- web/app/api web/lib`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: LOW (só adiciona testes)
- **Depends on**: idealmente após 010/012/016/018 (testa as guardas deles); não bloqueia
- **Category**: tests
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

O lado web — exatamente o tier que gate-keia auth, multi-tenancy e a fila de
publicação — tem UM teste (`web/lib/crypto.test.ts`). As rotas que criam/editam/
cancelam posts e o pipeline de lógica pura (`story-doc.ts`, `presets.ts`) não
têm nenhuma proteção contra regressão; o CI web passa trivialmente. Antes de
refatorar o editor (plano 021) ou evoluir o feed, é preciso uma rede de testes
de caracterização: descrever o comportamento atual e travá-lo.

## Current state

- Runner: vitest 4 (`web/package.json`: `"test": "vitest run"`). Exemplar:
  `web/lib/crypto.test.ts` (`describe/it/expect`, `beforeAll` pra env).
- Rotas alvo (App Router, handlers exportados):
  - `web/app/api/media/create/route.ts` — `POST(request: NextRequest)`; lê
    `request.formData()`, usa `createClient()` de `@/lib/supabase/server`,
    chama `fetch` pro image-service, dois inserts.
  - `web/app/api/schedule/[id]/route.ts` — `PUT`/`DELETE` com
    `{ params }: { params: Promise<{ id: string }> }` (params é **Promise** no
    Next 16 — await obrigatório).
  - `web/app/api/presets/route.ts` + `[id]/route.ts` — CRUD de presets com
    `validateStyle`/`normalizeStyle`.
- Dependências a mockar: `@/lib/supabase/server` (função `createClient`
  async → objeto com `auth.getUser()`, `from().insert()/select()/update()...`)
  e `global.fetch` (image-service).
- Lógica pura sem teste: `web/lib/story-doc.ts` (`docCaption`, `docFromLegacy`,
  `targetFromAspect` — se o plano 017 foi aplicado, parte já coberta; não
  duplicar), `web/lib/presets.ts` (`validateStyle`, `normalizeStyle`).
- AVISO Next.js 16 (`web/AGENTS.md`): APIs podem divergir do seu conhecimento —
  em dúvida sobre `NextRequest`/handlers, consultar
  `web/node_modules/next/dist/docs/`.

## Commands you will need

| Purpose | Command (rodar em `web/`) | Expected on success |
|---------|---------------------------|---------------------|
| Testes | `npm test` | todos passam |
| Teste único | `npx vitest run app/api/media/create/route.test.ts` | passa |
| Lint | `npm run lint` | exit 0 |

## Suggested executor toolkit

- Skill `vercel-react-best-practices` (se disponível) para convenções Next.
- `web/node_modules/next/dist/docs/` — docs da versão real instalada.

## Scope

**In scope** (criar):
- `web/app/api/media/create/route.test.ts`
- `web/app/api/schedule/[id]/route.test.ts`
- `web/lib/presets.test.ts`
- `web/lib/story-doc.test.ts` (só se o plano 017 ainda não o criou; senão, ampliar)
- `web/test/helpers.ts` (mock builder do Supabase client)

**Out of scope**:
- QUALQUER mudança em código de produção (rotas/libs). Se um teste revelar bug,
  registre no relatório final — não conserte aqui.
- Testes de componente/interação do editor (ficam pro plano 021).
- E2E/browser.

## Git workflow

- Branch atual (`main`), conventional commit, ex.:
  `test: characterization tests for web API routes`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Helper de mock do Supabase

Criar `web/test/helpers.ts` com um builder encadeável:

```ts
import { vi } from "vitest";

export function mockSupabase(overrides: {
  user?: { id: string } | null;
  tables?: Record<string, { data?: unknown; error?: { message: string } | null }>;
} = {}) {
  const result = (t: string) => overrides.tables?.[t] ?? { data: null, error: null };
  const chain = (t: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "delete", "eq", "order", "limit"])
      c[m] = vi.fn(() => c);
    c.single = vi.fn(async () => result(t));
    c.maybeSingle = vi.fn(async () => result(t));
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result(t)).then(res);
    return c;
  };
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: overrides.user ?? { id: "u1" } } })) },
    from: vi.fn((t: string) => chain(t)),
  };
}
```

E mockar o módulo nos testes de rota:

```ts
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => sb) }));
```

Ajuste o builder ao uso real observado em cada rota (ele é um ponto de partida,
não um contrato); mantenha-o mínimo.

**Verify**: `npm test` → suite existente segue verde.

### Step 2: Testes de `media/create`

Casos (chamar `POST(new NextRequest(...))` com `FormData` real):

1. Sem sessão (`user: null`) → 401.
2. Sem arquivo ou sem `account_id` → 400 antes de qualquer fetch
   (`expect(fetch).not.toHaveBeenCalled()`).
3. `scheduled_at` no passado → 400.
4. Caminho feliz story: fetch pro `/process` chamado com header
   `X-Service-Token`, inserts em `media` e `posts`, resposta `{ ok: true }`.
5. `target` inválido no form → tratado como story (comportamento atual da
   linha `targetRaw in TARGETS ? ... : "story"`).
6. Se plano 010 aplicado: `account_id` inexistente → 404.
7. Se plano 016 aplicado: `doc` malformado → 400 sem fetch.

Env vars necessárias: `IMAGE_SERVICE_URL`, `SERVICE_SHARED_SECRET` via
`beforeAll` (padrão do `crypto.test.ts`).

**Verify**: `npx vitest run app/api/media/create/route.test.ts` → passa.

### Step 3: Testes de `schedule/[id]`

Lembrar: `params` é `Promise<{ id }>` — passar
`{ params: Promise.resolve({ id: "p1" }) }`.

1. PUT sem sessão → 401; post inexistente → 404; status `published` → 409.
2. PUT só reagendando (futuro) → update de `posts` com `scheduled_at` ISO;
   sem fetch de reprocesso.
3. PUT com `doc` alterado → fetch a `/reprocess` + update de `media`.
4. PUT `scheduled_at` no passado → 400.
5. DELETE post `queued` → delete em `media` (cascata) → `{ ok: true }`;
   status não-editável → 409.

**Verify**: `npx vitest run "app/api/schedule/[id]/route.test.ts"` → passa.

### Step 4: Lógica pura

`web/lib/presets.test.ts`: `validateStyle` aceita config default; rejeita hex
inválido, opacity 256, width 21, size_factor 0.21; `normalizeStyle(null)` ==
`DEFAULT_STYLE`; merge parcial preserva sub-objetos.
`web/lib/story-doc.test.ts` (se não existir do 017): `docCaption`,
`docFromLegacy` (caption vazia → doc vazio; com caption → 1 elemento com o
estilo), `targetFromAspect`.

**Verify**: `npm test` → tudo verde.

### Step 5: CI já cobre

`.github/workflows/ci.yml` roda `npm test --if-present` — nada a mudar; conferir
que a suite roda no CI local via `npm test` na raiz de `web/`.

**Verify**: `npm test` → N testes novos, todos verdes; `npm run lint` → exit 0.

## Test plan

Este plano É o test plan. Meta mínima: ~20 casos novos cobrindo as duas rotas de
mutação da fila + as duas libs puras.

## Done criteria

- [ ] `npm test` exit 0 com os arquivos novos listados no Scope
- [ ] Nenhum arquivo de produção modificado (`git status` mostra só testes/helper)
- [ ] Casos 401/400/404/409 das duas rotas cobertos
- [ ] `plans/README.md` atualizado

## STOP conditions

- Handler não instanciável em ambiente de teste (ex.: `NextRequest` exigir
  runtime edge) — antes de adicionar dependência nova (ex.:
  `next-test-api-route-handler`), pare e reporte a opção.
- Mock do Supabase exigir comportamento que o helper não expressa sem virar um
  fake gigante — reporte; talvez o certo seja extrair a lógica da rota.
- Um teste revelar bug real de produção — registre e siga (não conserte aqui).

## Maintenance notes

- Estes testes são pré-requisito do plano 021 (refactor do editor) e de
  qualquer evolução do feed — mantê-los rodando no CI.
- Ao aplicar os planos 010/016/018 DEPOIS deste, atualizar os casos 5-7 do
  Step 2 (as guardas mudam o comportamento caracterizado).
- Revisor: atenção a testes que só exercitam o mock (asserte status/corpo da
  resposta e os argumentos dos fetches, não a mecânica interna do helper).
