# Plan 010: Validar que `account_id` pertence ao usuário antes de criar/editar post

> **Executor instructions**: Siga passo a passo. Rode cada comando de verificação
> e confirme o resultado esperado antes do próximo passo. Se qualquer condição de
> "STOP conditions" ocorrer, pare e reporte — não improvise. Ao terminar, atualize
> a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: o working tree pode conter trabalho não
> commitado (feature de feed). Compare os excerpts de "Current state" abaixo com o
> código vivo em vez de confiar só no SHA. Em caso de divergência real (código
> diferente do descrito), trate como STOP.
> `git diff --stat 2db4580..HEAD -- web/app/api/media/create/route.ts "web/app/api/schedule/[id]/route.ts"`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

As rotas de criação e edição de post aceitam `account_id` vindo do cliente e o
gravam direto em `media.account_id` / `posts.account_id`. O RLS garante que a
**linha** pertence ao usuário (`owner = auth.uid()`), mas não valida a **FK**: um
usuário autenticado que descubra o UUID de `ig_accounts` de outro tenant pode
criar/reapontar um post para a conta da vítima. O scheduler (image-service,
service role) depois carrega o token da conta pelo `account_id` e publica — ou
seja, conteúdo do atacante publicado no Instagram da vítima (IDOR cross-tenant).
UUIDs aleatórios reduzem, mas não eliminam, a exposição.

## Current state

Arquivos relevantes:

- `web/app/api/media/create/route.ts` — cria media + post agendado. O
  `accountId` vem do form (linha 29) e é inserido sem checagem de dono
  (linhas 107 e 130):
  ```ts
  const accountId = form.get("account_id") as string;          // :29
  ...
  .insert({ owner: user.id, account_id: accountId, ... })      // :105-107 (media)
  ...
  await supabase.from("posts").insert({ owner: user.id, account_id: accountId, ... }) // :128-131
  ```
- `web/app/api/schedule/[id]/route.ts` — edita post da fila. Linha 146 aceita
  qualquer `account_id` do body:
  ```ts
  if (typeof body.account_id === "string") patch.account_id = body.account_id; // :146
  ```
- Convenção de auth das rotas (exemplar): todas começam com
  `const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();`
  e retornam `{ error: "..." }` com status apropriado (ver
  `web/app/api/media/create/route.ts:16-20`). Mensagens de erro em pt-BR,
  minúsculas.
- A tabela `ig_accounts` tem `id` (uuid) e `owner` (uuid, RLS por
  `owner = auth.uid()`), ver `supabase/migrations/0001_init.sql`. Como a query
  roda com o client **anon + sessão do usuário** (não service role), um
  `select` em `ig_accounts` só enxerga contas do próprio usuário — a checagem
  pode ser simplesmente "buscar a conta por id e ver se veio linha".

## Commands you will need

| Purpose | Command (rodar em `web/`) | Expected on success |
|---------|---------------------------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Testes | `npm test` | todos passam |
| Build/typecheck | `npm run build` | exit 0 |

## Scope

**In scope** (únicos arquivos a modificar):
- `web/app/api/media/create/route.ts`
- `web/app/api/schedule/[id]/route.ts`

**Out of scope**:
- Migrations SQL (uma policy com subquery em `ig_accounts.owner` seria defesa em
  profundidade, mas fica registrada como follow-up — não fazer aqui).
- `image-service/` — o scheduler não muda.
- Qualquer mudança no shape de resposta das rotas.

## Git workflow

- Pode trabalhar direto na branch atual (`main`) — convenção observada no repo.
- Commit no estilo conventional commits em inglês, ex.: `fix: validate account ownership in media/schedule routes`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Guarda de dono em `media/create`

Em `web/app/api/media/create/route.ts`, logo depois da validação
`if (!(file instanceof Blob) || !accountId)` (linha ~41), adicionar:

```ts
// A conta precisa ser do próprio usuário (RLS já filtra por owner).
const { data: account } = await supabase
  .from("ig_accounts")
  .select("id")
  .eq("id", accountId)
  .maybeSingle();
if (!account) {
  return NextResponse.json({ error: "conta não encontrada" }, { status: 404 });
}
```

Importante: fazer isso **antes** da chamada ao image-service `/process` (linha
~80), para não subir imagem ao Storage em requisição inválida.

**Verify**: `npm run lint` → exit 0.

### Step 2: Guarda de dono no PUT de `schedule/[id]`

Em `web/app/api/schedule/[id]/route.ts`, no bloco do patch (linha ~146),
substituir a atribuição direta por:

```ts
if (typeof body.account_id === "string") {
  const { data: account } = await supabase
    .from("ig_accounts")
    .select("id")
    .eq("id", body.account_id)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: "conta não encontrada" }, { status: 404 });
  }
  patch.account_id = body.account_id;
}
```

**Verify**: `npm run lint` → exit 0.

### Step 3: Build

**Verify**: `npm run build` → exit 0 (o build faz typecheck).

## Test plan

Não há infraestrutura de teste de rotas hoje (só `web/lib/crypto.test.ts`);
o plano 019 cria essa base. Aqui a verificação é estática (lint + build) +
teste manual se houver ambiente: logado, mandar `account_id` inexistente ao
criar → deve responder 404 `conta não encontrada` sem chamar o image-service.
Quando o plano 019 existir, adicionar os casos: (a) criar com conta de outro
owner → 404; (b) PUT trocando para conta de outro owner → 404.

## Done criteria

- [ ] `npm run lint` exit 0
- [ ] `npm run build` exit 0
- [ ] Em `create/route.ts`, a busca em `ig_accounts` acontece **antes** do fetch a `/process`
- [ ] `git status` não mostra arquivos modificados fora do escopo
- [ ] Linha do plano atualizada em `plans/README.md`

## STOP conditions

- O código nas localizações citadas não bate com os excerpts (drift).
- `supabase.from("ig_accounts")` retornar erro de permissão em teste manual —
  indicaria que a RLS de `ig_accounts` não é `owner = auth.uid()` como assumido;
  pare e reporte.
- A correção parecer exigir mudança em migration ou no image-service.

## Maintenance notes

- Se surgir rota nova que aceite `account_id` do cliente (ex.: bulk create),
  replicar a mesma guarda.
- Follow-up deferido: policy de INSERT/UPDATE em `posts`/`media` com
  `account_id in (select id from ig_accounts where owner = auth.uid())` como
  defesa em profundidade no banco.
- Revisor: conferir que a checagem usa o client com sessão do usuário (não
  service role), senão a RLS não filtra nada.
