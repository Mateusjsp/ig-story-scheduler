# Plan 002: Proteger o OAuth do Instagram contra CSRF com `state`

> **Executor instructions**: Siga passo a passo. Rode cada verificação. Pare nas
> "STOP conditions" — não improvise. Ao fim, atualize a linha em `plans/README.md`.
>
> **Drift check**: monorepo **não-commitado** quando este plano foi escrito (working
> tree `main`, HEAD `bc4230d`). Compare os excerpts de "Current state" com o código
> vivo antes de mexer; divergência = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: working tree em `main` (HEAD `bc4230d`, não-commitado), 2026-06-29

## Why this matters

O fluxo OAuth do Instagram não usa o parâmetro `state`. Sem ele, um atacante pode
montar um link de callback com um `code` da **conta Instagram dele** e fazer a vítima
(logada no painel) abrir esse link — o callback então conecta a conta do atacante à
sessão da vítima (login CSRF / account confusion). A vítima passaria a publicar na
conta do atacante, ou o atacante ganha um canal de conteúdo na conta da vítima. O
`state` é um token aleatório, guardado em cookie httpOnly, gerado no início e
conferido no callback — o padrão OAuth contra CSRF. Depois deste plano, callbacks sem
`state` válido são rejeitados.

## Current state

- `web/app/api/instagram/start/route.ts` — monta a URL de authorize e redireciona.
  **Não** seta `state`. Excerpt:

```ts
  const redirectUri = `${site}/api/instagram/callback`;
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
  return NextResponse.redirect(url.toString());
```

- `web/app/api/instagram/callback/route.ts` — recebe `code`, troca por tokens, salva
  a conta. **Não** lê nem confere `state`. Excerpt do início:

```ts
export async function GET(request: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const dest = (q: string) => NextResponse.redirect(`${origin}/dashboard/accounts?${q}`);
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return dest("error=sem_code");
  ...
```

- Convenções: rotas em `app/api/**/route.ts`, Next 16 App Router. Cookies em route
  handler: ler via `request.cookies.get(name)`, setar via `response.cookies.set(...)`.
  Geração de aleatório: `crypto.randomUUID()` (Web Crypto, disponível no runtime Node
  do Next) ou `node:crypto`. Veja `web/lib/crypto.ts` que já usa `node:crypto`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Build do web | `cd web && npm run build` | exit 0, "Compiled successfully" |
| Lint do web | `cd web && npm run lint` | exit 0 |

## Scope

**In scope:**
- `web/app/api/instagram/start/route.ts`
- `web/app/api/instagram/callback/route.ts`

**Out of scope (NÃO tocar):**
- `web/lib/crypto.ts` — cifragem de token, sem relação com CSRF.
- `web/proxy.ts` — o callback exige usuário logado; a proteção de sessão já existe ali.
- A troca de tokens em si (já funciona) — só adicione a verificação de `state`.

## Git workflow

- Branch: `advisor/002-oauth-state-csrf`
- Commits conventional.
- Sem push/PR salvo instrução.

## Steps

### Step 1: Gerar `state`, setar cookie e mandar na URL (start)

Reescreva `web/app/api/instagram/start/route.ts` pra gerar um `state`, anexá-lo à URL
e gravá-lo num cookie httpOnly na resposta de redirect:

```ts
import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";

export async function GET(request: NextRequest) {
  const appId = process.env.INSTAGRAM_APP_ID;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  if (!appId) {
    return NextResponse.json({ error: "INSTAGRAM_APP_ID não configurado." }, { status: 500 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${site}/api/instagram/callback`;
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min
  });
  return res;
}
```

**Verify**: `cd web && grep -n "ig_oauth_state" app/api/instagram/start/route.ts` → 1 match. `npm run build` → exit 0.

### Step 2: Conferir `state` no callback

Em `web/app/api/instagram/callback/route.ts`, logo após pegar o `code`, leia o `state`
da query e do cookie e compare. Em mismatch, rejeite. Limpe o cookie ao final.

Adicione após `if (!code) return dest("error=sem_code");`:

```ts
  const state = request.nextUrl.searchParams.get("state");
  const cookieState = request.cookies.get("ig_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    return dest("error=state_invalido");
  }
```

E onde a função retorna sucesso (`return dest("ok=1");`) e nos retornos de erro, limpe
o cookie. A forma mais simples: construa a resposta, delete o cookie, retorne. Troque
o helper `dest` por uma versão que limpa o cookie:

```ts
  const dest = (q: string) => {
    const r = NextResponse.redirect(`${origin}/dashboard/accounts?${q}`);
    r.cookies.delete("ig_oauth_state");
    return r;
  };
```

(coloque essa definição de `dest` no lugar da atual, no topo da função).

**Verify**: `cd web && grep -n "state_invalido\|ig_oauth_state" app/api/instagram/callback/route.ts` → ≥2 matches. `npm run build` → exit 0.

## Test plan

Não há harness de teste no `web` ainda (o Plan 003 adiciona vitest). Portanto a
verificação aqui é **build + revisão manual + teste E2E manual**:

- Build verde (`npm run build`).
- E2E manual (quando o Supabase/Meta estiverem configurados): clicar "Conectar
  Instagram" → o redirect tem `state=` na URL; ao voltar, a conta conecta. Forjar um
  callback com `state` ausente/errado → redireciona com `error=state_invalido` e NÃO
  cria conta.
- Se o Plan 003 já tiver landado (vitest disponível), adicione um teste unitário que
  chama o handler `GET` de start e confere que a resposta seta o cookie `ig_oauth_state`
  e que a URL de Location contém `state=`. Caso contrário, pule (não bloqueie por isso).

## Done criteria

- [ ] `cd web && npm run build` exits 0
- [ ] `cd web && npm run lint` exits 0
- [ ] `grep -rn "state" web/app/api/instagram/start/route.ts` mostra `state` na URL e no cookie
- [ ] `grep -rn "state_invalido" web/app/api/instagram/callback/route.ts` retorna match
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] Linha de status atualizada em `plans/README.md`

## STOP conditions

Pare e reporte se:
- Os excerpts de "Current state" não baterem com o código vivo.
- `npm run build` falhar duas vezes após correção razoável.
- O cookie não persistir entre start e callback por causa de domínio/redirect
  cross-site (Instagram → seu domínio): `sameSite: "lax"` deve bastar para um
  top-level GET de volta; se em teste real o cookie sumir, PARE e reporte (pode
  precisar de `sameSite: "none"; secure`, decisão de operador).

## Maintenance notes

- O cookie usa `secure` só em produção; em `localhost` (http) fica não-secure de
  propósito. Não mude isso sem ajustar o ambiente de dev.
- Se um dia o callback virar `POST` ou o domínio do painel mudar, revise `sameSite`.
- Reviewer deve checar que o `state` é comparado por igualdade simples (é um token
  aleatório de uso único, não segredo de longa vida) e que o cookie é limpo em TODOS
  os caminhos de saída do callback.
