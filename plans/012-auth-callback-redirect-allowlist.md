# Plan 012: Restringir o redirect `next` no callback de auth a caminhos internos

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: compare o excerpt de "Current state" com o
> arquivo vivo. Divergência real = STOP.
> `git diff --stat 2db4580..HEAD -- web/app/auth/callback/route.ts`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

O callback de auth do Supabase concatena `origin` + `next` sem validar `next`.
Como não há `/` obrigatório entre os dois, um `next` como `.dominio-do-atacante.com`
produz `https://painel.exemplo.com.dominio-do-atacante.com` — host do atacante.
Um link de confirmação de e-mail/reset adulterado pode, após o login legítimo,
mandar o usuário para um site de phishing. Fluxos legítimos só usam caminhos
relativos (`/dashboard`, `/reset-password`), então a restrição não quebra nada.

## Current state

- `web/app/auth/callback/route.ts` (arquivo inteiro, 16 linhas):
  ```ts
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";     // :8

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);  // :13
  }
  return NextResponse.redirect(`${origin}/login`);
  ```
- Consumidores conhecidos de `next` no repo: fluxo de reset de senha aponta para
  `/reset-password` (ver `web/app/reset-password/page.tsx` /
  `web/app/login/page.tsx`); default é `/dashboard`.

## Commands you will need

| Purpose | Command (rodar em `web/`) | Expected on success |
|---------|---------------------------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Testes | `npm test` | todos passam |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `web/app/auth/callback/route.ts`
- `web/lib/safe-next.test.ts` e `web/lib/safe-next.ts` (criar — ver Test plan)

**Out of scope**:
- `web/app/api/instagram/callback/route.ts` — OAuth da Meta usa `state` cookie e
  redirect fixo; não mexer.
- Páginas de login/reset (elas já geram `next` válido).

## Git workflow

- Branch atual (`main`), conventional commit, ex.:
  `fix: restrict auth callback redirect to internal paths`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Helper de sanitização

Criar `web/lib/safe-next.ts`:

```ts
/** Aceita só caminho interno: começa com exatamente um "/", sem esquema/host. */
export function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  // um único "/" inicial; bloqueia "//host", "/\host", esquemas e userinfo
  if (!/^\/(?![/\\])/.test(raw)) return "/dashboard";
  return raw;
}
```

**Verify**: `npm run lint` → exit 0.

### Step 2: Usar no callback

Em `web/app/auth/callback/route.ts`:

```ts
import { safeNext } from "@/lib/safe-next";
...
const next = safeNext(searchParams.get("next"));
```

(mantendo o resto igual — o redirect continua `${origin}${next}`).

**Verify**: `npm run build` → exit 0.

### Step 3: Testes

Criar `web/lib/safe-next.test.ts` no padrão de `web/lib/crypto.test.ts`
(vitest, `describe`/`it`/`expect`). Casos mínimos:
- `"/dashboard"` → `"/dashboard"`; `"/reset-password"` → passa.
- `null`, `""` → `"/dashboard"`.
- `"//evil.com"`, `"/\\evil.com"`, `".evil.com"`, `"https://evil.com"`,
  `"@evil.com"` → todos `"/dashboard"`.

**Verify**: `npm test` → todos passam, incluindo os novos.

## Test plan

Coberto no Step 3 — teste unitário puro do helper; a rota fica trivial demais
para exigir teste de integração.

## Done criteria

- [ ] `npm test` exit 0 com os casos maliciosos listados
- [ ] `npm run build` exit 0
- [ ] `grep -n 'searchParams.get("next")' web/app/auth/callback/route.ts` mostra a chamada envolta em `safeNext(`
- [ ] `git status` limpo fora do escopo
- [ ] `plans/README.md` atualizado

## STOP conditions

- O arquivo do callback não bater com o excerpt (drift).
- Descobrir outro produtor de `next` que use caminho não-relativo legítimo
  (quebraria com a allowlist) — reporte em vez de afrouxar a regex.

## Maintenance notes

- Qualquer rota nova que aceite parâmetro de redirect deve passar por
  `safeNext` (ou allowlist equivalente).
- Revisor: conferir a regex — `^\/(?![/\\])` exige exatamente um `/` inicial e
  rejeita `//` e `/\` (bypass clássico de parser de URL).
