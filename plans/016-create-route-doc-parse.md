# Plan 016: Validar o JSON do `doc` antes de processar (evita 500 + Storage órfão)

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: compare os excerpts de "Current state" com o
> código vivo. Se o plano 010 já foi aplicado, haverá uma checagem de
> `ig_accounts` no início — esperado, não é drift.
> `git diff --stat 2db4580..HEAD -- web/app/api/media/create/route.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

Na rota de criação, `docRaw` é parseado DUAS vezes: `deriveCaption` engole erro
de parse (retorna null), mas logo na linha seguinte `JSON.parse(docRaw)` roda
**sem guarda**. Se o JSON for inválido, a exceção estoura DEPOIS do passo 1
(`/process`), que já subiu imagem tratada + original pro Storage → resposta 500
genérica e dois objetos órfãos no bucket (nenhuma linha de `media` os
referencia; nada os limpa). Validar antes de gastar processamento resolve os
dois problemas e ainda elimina o parse duplicado de um payload potencialmente
grande.

## Current state

- `web/app/api/media/create/route.ts:5-12` — `deriveCaption` com try/catch
  próprio:
  ```ts
  function deriveCaption(docRaw: string): string | null {
    try {
      return docCaption(JSON.parse(docRaw) as StoryDoc) || null;
    } catch {
      return null;
    }
  }
  ```
- `web/app/api/media/create/route.ts:109-112` — o insert re-parseia sem guarda
  (e `style` idem):
  ```ts
  caption: docRaw ? deriveCaption(docRaw) : caption,
  doc: docRaw ? JSON.parse(docRaw) : null,
  style: style ? JSON.parse(style) : null,
  ```
- A chamada ao image-service acontece antes, nas linhas ~78-100 (`/process`
  sobe `processed` + `original` no Storage).
- Convenção de validação da rota: retornos `NextResponse.json({ error: "..." },
  { status: 400 })` cedo, mensagens pt-BR minúsculas (ver linhas 41-65).

## Commands you will need

| Purpose | Command (rodar em `web/`) | Expected on success |
|---------|---------------------------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Testes | `npm test` | todos passam |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `web/app/api/media/create/route.ts`

**Out of scope**:
- Limpeza de órfãos já existentes no Storage (operacional).
- Rollback/limpeza quando o INSERT de `media` falha após o `/process` (falha de
  banco pós-upload ainda órfã — deferido, ver Maintenance notes).
- `web/app/api/schedule/[id]/route.ts` (lá o `body.doc` já chega como objeto do
  `request.json()`, sem parse manual).

## Git workflow

- Branch atual (`main`), conventional commit, ex.:
  `fix: parse doc/style JSON once and before processing`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Parse único e antecipado

Logo após ler os campos do form (depois da linha ~39, antes da validação de
data), parsear uma única vez:

```ts
let parsedDoc: StoryDoc | null = null;
if (docRaw) {
  try {
    parsedDoc = JSON.parse(docRaw) as StoryDoc;
  } catch {
    return NextResponse.json({ error: "doc inválido (JSON malformado)" }, { status: 400 });
  }
}
let parsedStyle: unknown = null;
if (style) {
  try {
    parsedStyle = JSON.parse(style);
  } catch {
    return NextResponse.json({ error: "style inválido (JSON malformado)" }, { status: 400 });
  }
}
```

### Step 2: Reusar os objetos parseados

No insert de `media` (linhas ~103-122), trocar:

```ts
caption: parsedDoc ? docCaption(parsedDoc) || null : caption,
doc: parsedDoc,
style: parsedStyle,
```

Importar `docCaption` já está feito (linha 3). Remover a função `deriveCaption`
(fica sem uso) — o lint acusa se esquecer.

**Verify**: `npm run lint` → exit 0 (sem unused vars).

### Step 3: Build

**Verify**: `npm run build` → exit 0.

## Test plan

Sem harness de rotas ainda (plano 019). Verificação estática + manual: enviar
form com `doc` = `"{invalid"` → 400 imediato `doc inválido (JSON malformado)`,
e conferir (log do image-service) que `/process` NÃO foi chamado. Quando o
plano 019 existir, adicionar caso: doc malformado → 400 antes do fetch.

## Done criteria

- [ ] `npm run lint` exit 0 e `npm run build` exit 0
- [ ] `grep -c "JSON.parse(docRaw)" web/app/api/media/create/route.ts` retorna 1 (o parse único do Step 1)
- [ ] O parse acontece ANTES do `fetch` a `/process` (leitura do diff)
- [ ] `git status` limpo fora do escopo
- [ ] `plans/README.md` atualizado

## STOP conditions

- Os excerpts não baterem com o código (além dos deltas esperados dos planos
  010/018).
- Aparecer dependência do shape exato de `deriveCaption` em outro arquivo
  (grep antes de remover; hoje é local à rota).

## Maintenance notes

- Deferido: try/catch em volta dos inserts de `media`/`posts` com remoção
  best-effort dos objetos recém-subidos em caso de falha (exigiria endpoint de
  delete no image-service ou usar o client Supabase do web com service role).
- Revisor: conferir que `caption` legado (sem doc) continua funcionando —
  `parsedDoc === null` → usa o `caption` do form.
