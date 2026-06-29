# Plan 006: Validar que o agendamento é uma data futura

> **Executor instructions**: Siga passo a passo, rode cada verificação, STOP nas
> condições. Ao fim, atualize `plans/README.md`.
>
> **Drift check**: monorepo **não-commitado** (working tree `main`, HEAD `bc4230d`).
> Compare excerpts com o código vivo; divergência = STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: working tree em `main` (HEAD `bc4230d`, não-commitado), 2026-06-29

## Why this matters

A rota `POST /api/media/create` recebe `scheduled_at` do formulário e insere o post sem
validar. Se o valor estiver no passado (ou for inválido/vazio em formato inesperado), o
post entra na fila já vencido e o scheduler **publica na hora seguinte** — sem o usuário
querer. Pior: uma data malformada vira `Invalid Date` → `.toISOString()` lança e a rota
quebra com 500 sem mensagem útil. Este plano valida que `scheduled_at` é uma data
válida e no futuro, devolvendo 400 com mensagem clara caso contrário.

## Current state

- `web/app/api/media/create/route.ts` — pega os campos e insere. Excerpts:

```ts
  const scheduledAt = form.get("scheduled_at") as string;

  if (!(file instanceof Blob) || !accountId || !scheduledAt) {
    return NextResponse.json({ error: "dados incompletos" }, { status: 400 });
  }
  ...
  // 3. agenda o post
  const { error: pErr } = await supabase.from("posts").insert({
    owner: user.id,
    account_id: accountId,
    media_id: media.id,
    scheduled_at: new Date(scheduledAt).toISOString(),
    status: "queued",
  });
```

- O componente que chama é `web/app/dashboard/media/uploader.tsx` (input
  `datetime-local`), mas a validação **deve** ficar no servidor (a rota) — nunca
  confie só no client.
- Convenção de erro nas rotas: `NextResponse.json({ error: "..." }, { status: 400 })`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Build do web | `cd web && npm run build` | exit 0 |
| Lint do web | `cd web && npm run lint` | exit 0 |
| Testes web (se Plan 003 landou) | `cd web && npm run test` | passam |

## Scope

**In scope:**
- `web/app/api/media/create/route.ts`
- `web/app/api/media/create/route.test.ts` (criar — SOMENTE se vitest já existir, ver Step 3)

**Out of scope (NÃO tocar):**
- `web/app/dashboard/media/uploader.tsx` — validação de client é opcional e não é o
  alvo; o servidor é a fonte da verdade.
- O fluxo de `/process` e a criação de `media` — só valide a data antes de inserir o post.

## Git workflow

- Branch: `advisor/006-validate-future-schedule`
- Commits conventional.
- Sem push/PR salvo instrução.

## Steps

### Step 1: Validar a data no servidor

Em `web/app/api/media/create/route.ts`, logo após o check de "dados incompletos",
adicione a validação:

```ts
  const scheduledDate = new Date(scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) {
    return NextResponse.json({ error: "data de agendamento inválida" }, { status: 400 });
  }
  if (scheduledDate.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "o horário precisa ser no futuro" },
      { status: 400 },
    );
  }
```

E troque o uso posterior por `scheduledDate.toISOString()`:

```ts
    scheduled_at: scheduledDate.toISOString(),
```

**Verify**: `cd web && npm run build` → exit 0. `cd web && grep -n "no futuro" app/api/media/create/route.ts` → 1 match.

### Step 2: Mensagem amigável no client (opcional, leve)

Em `web/app/dashboard/media/uploader.tsx`, o `schedule()` já mostra `error` vindo da
resposta. Garanta que o erro do servidor apareça (já acontece via `setError`). Sem
mudança obrigatória aqui; só confirme que a mensagem do 400 chega na UI.

**Verify**: nenhuma (revisão visual). Não altere a lógica de fetch existente.

### Step 3: Teste (apenas se vitest já existir)

Se o Plan 003 já tiver landado (existe `web/package.json` com script `test` e vitest
instalado), crie `web/app/api/media/create/route.test.ts` testando a validação de data.
Como a rota depende de Supabase e do image-service, teste só a guarda de data extraindo-a
ou mockando: o caminho mais simples é um teste que monta um `Request` com `scheduled_at`
no passado e mocka `@/lib/supabase/server` pra retornar um user; o esperado é status 400
antes de qualquer fetch externo.

Se montar esse mock for custoso, **pule** este step e registre no relatório que a
validação foi coberta por build + teste manual (não bloqueie o plano por isto).

**Verify** (se feito): `cd web && npm run test` → passa.

### Step 4: Verificação final

**Verify**: `cd web && npm run build && npm run lint` → ambos exit 0.

## Test plan

- Se vitest disponível: caso "data no passado → 400" e "data inválida → 400".
- Caso contrário: build + teste manual (agendar com horário passado → UI mostra "o
  horário precisa ser no futuro"; o post NÃO é criado).
- Padrão: rotas Next testadas com `Request`/`Response` web-standard.

## Done criteria

- [ ] `cd web && npm run build` exits 0
- [ ] `cd web && npm run lint` exits 0
- [ ] `grep -n "no futuro" web/app/api/media/create/route.ts` → 1 match
- [ ] `grep -n "data de agendamento inválida" web/app/api/media/create/route.ts` → 1 match
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] Linha de status atualizada em `plans/README.md`

## STOP conditions

Pare e reporte se:
- O excerpt de `route.ts` divergir do código vivo.
- `npm run build` falhar duas vezes após correção razoável.

## Maintenance notes

- A validação usa o horário do servidor (`Date.now()`). O input `datetime-local` é hora
  local do usuário; a conversão `new Date(scheduledAt)` interpreta no fuso do servidor.
  Se no futuro houver timezone por conta (`account_settings.timezone` existe no schema),
  a conversão deve passar a respeitá-lo — revisite aqui.
- Reviewer deve confirmar que a validação está no SERVIDOR (não só no client).
