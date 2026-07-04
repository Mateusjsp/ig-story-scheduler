# Plan 021: Decompor o `story-editor.tsx` (god-component de 747 linhas)

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: o editor é o arquivo de maior churn do repo —
> compare a estrutura descrita em "Current state" com o arquivo vivo ANTES de
> começar; se funções/linhas mudaram muito, pare e reporte.
> `git diff --stat 2db4580..HEAD -- web/components/story-editor.tsx web/app/dashboard/media/uploader.tsx "web/app/dashboard/schedule/[id]/post-editor.tsx"`

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED (lógica interativa de canvas; regressão de gesto é fácil)
- **Depends on**: plans/019-web-route-tests.md (rede de testes primeiro) — e
  fazer plano 017 antes ajuda (trava o contrato do doc)
- **Category**: tech-debt
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

`web/components/story-editor.tsx` concentra num arquivo só: máquina de estados
de gestos (drag/resize/rotate), histórico undo/redo, atalhos globais de teclado,
zoom por wheel, 5 componentes de camada/painel e helpers de estilo. É o arquivo
que mais muda (crop/zoom, layers, footer, acessibilidade nos últimos commits) e
cada feature nova atravessa tudo — com dois `eslint-disable
react-hooks/exhaustive-deps` marcando pontos onde a mecânica de hooks já
apertou. Decompor reduz o custo de toda evolução futura do editor (que é o
coração do produto) e torna a lógica testável isoladamente.

## Current state

Estrutura atual de `web/components/story-editor.tsx` (747 linhas; números
aproximados — o arquivo muda com frequência):

- `:32-36` — helpers `clamp`, `nowMs`, `dupId`.
- `:38` — `export function StoryEditor({ doc, onChange, bgSrc, aspectW, aspectH, footer })`
  (props exatas: conferir no arquivo; `aspectW/aspectH/footer` vieram do
  trabalho de feed).
- Dentro do componente: `syncHist`/`commit`/`undo`/`redo` (`:72-104`, histórico),
  `setPhoto`/`update`/`addText`/`addSticker`/`duplicate`/`remove`/`reorder`
  (`:106-157`, mutações do doc), `rect`/`onPointerDownBody`/`onPointerDownRotate`/
  `onPointerDownResize`/`onPointerMove`/`onStagePointerDown`/`onPointerUp`
  (`:159-235`, gestos), `useEffect` de teclado (`:237-280`, com
  eslint-disable) e `useEffect` de wheel-zoom (`:283-294`, idem).
- Fora do componente, no mesmo arquivo: `textShadow` (`:466`), `TextLayer`
  (`:477`), `StickerLayer` (`:530`), `Handles` (`:566`), `handleStyle` (`:596`),
  `hexA` (`:619`), `StickerPanel` (`:631`), `ElementPanel` (`:657`).
- Consumidores (2, ambos passam `doc/onChange/bgSrc/aspectW/aspectH/footer`):
  - `web/app/dashboard/media/uploader.tsx:148-261`
  - `web/app/dashboard/schedule/[id]/post-editor.tsx:114-169`
- Duplicação entre os consumidores (alvo do Step 5): footer com seletor de
  conta + `datetime-local` + feed caption quase idênticos; conversão
  local↔ISO reimplementada (`post-editor.tsx:24-28` `toLocalInput` vs
  `uploader.tsx:115` `new Date(when).toISOString()`).
- Tipos do doc: `web/lib/story-doc.ts` (`StoryDoc`, `Element`, `Photo`).
- Convenções: componentes função + hooks, Tailwind inline, comentários curtos
  em pt-BR. Testes: vitest (ver `web/lib/crypto.test.ts`).

## Commands you will need

| Purpose | Command (rodar em `web/`) | Expected on success |
|---------|---------------------------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Testes | `npm test` | todos passam |
| Build | `npm run build` | exit 0 |

## Suggested executor toolkit

- Skill `vercel-react-best-practices` (se disponível) — regras de hooks/memo.
- `web/AGENTS.md`: Next 16 difere do seu conhecimento; docs em
  `web/node_modules/next/dist/docs/`.

## Scope

**In scope**:
- `web/components/story-editor.tsx` (encolhe para orquestração + stage)
- Criar: `web/components/editor/use-editor-history.ts`,
  `web/components/editor/use-gestures.ts`,
  `web/components/editor/layers.tsx` (TextLayer/StickerLayer/Handles),
  `web/components/editor/panels.tsx` (ElementPanel/StickerPanel),
  `web/components/editor/post-settings-footer.tsx`,
  `web/lib/datetime.ts`
- Testes: `web/components/editor/use-editor-history.test.ts`,
  `web/lib/datetime.test.ts`
- Ajustar consumidores: `web/app/dashboard/media/uploader.tsx`,
  `web/app/dashboard/schedule/[id]/post-editor.tsx`

**Out of scope**:
- QUALQUER mudança de comportamento visível (gesto, atalho, visual). Isto é um
  refactor 1:1.
- `web/lib/story-doc.ts` (contrato — plano 017).
- Rotas de API.

## Git workflow

- Branch atual (`main`); commits PEQUENOS, um por step, ex.:
  `refactor: extract useEditorHistory from story-editor`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

Ordem pensada para o build nunca quebrar entre steps.

### Step 1: `useEditorHistory`

Extrair `syncHist/commit/undo/redo` + o estado de histórico para
`web/components/editor/use-editor-history.ts`, com assinatura aproximada:

```ts
export function useEditorHistory(doc: StoryDoc, onChange: (d: StoryDoc) => void) {
  return { commit, undo, redo, canUndo, canRedo };
}
```

Copiar a lógica EXATA (incluindo qualquer limite de tamanho de pilha).
`StoryEditor` passa a consumir o hook.

**Verify**: `npm run build` → exit 0; teste manual rápido se possível
(undo/redo no editor).

### Step 2: Teste do histórico

`use-editor-history.test.ts` com `@testing-library/react` `renderHook` SE a lib
já estiver instalada; caso NÃO esteja, testar a lógica pura: extrair a pilha
para funções puras (`pushHistory(state, doc)`, `undoState(state)`) e testar
essas. Não adicionar dependência nova sem reportar (STOP condition).
Casos: commit → undo volta; redo refaz; commit após undo descarta o futuro;
limite da pilha (se existir).

**Verify**: `npm test` → verde.

### Step 3: `useGestures` + camadas

- Mover `rect/onPointerDown*/onPointerMove/onStagePointerDown/onPointerUp` para
  `web/components/editor/use-gestures.ts` (recebe refs do stage, `commit`,
  `update`, seleção; devolve os handlers).
- Mover `TextLayer/StickerLayer/Handles/handleStyle/textShadow/hexA` para
  `web/components/editor/layers.tsx`; `ElementPanel/StickerPanel` para
  `web/components/editor/panels.tsx`. Exports nomeados; imports atualizados.

**Verify**: `npm run build` → exit 0; `npm run lint` → exit 0 (atenção aos dois
`eslint-disable react-hooks/exhaustive-deps` — mantenha-os onde a lógica exigir,
não os espalhe).

### Step 4: `story-editor.tsx` final

Após os steps 1-3 o arquivo deve conter só: o componente `StoryEditor`
(composição stage + painéis + footer), os `useEffect` de teclado/wheel (ou
extraídos para o use-gestures se natural) e o estado de seleção.
Meta: **< 300 linhas**.

**Verify**: `wc -l web/components/story-editor.tsx` < 300; `npm run build` exit 0.

### Step 5: Desduplicar o footer dos consumidores

- Criar `web/lib/datetime.ts` com `toLocalInput(iso: string)` (copiar de
  `post-editor.tsx:24-28`) e `fromLocalInput(local: string): string`
  (`new Date(local).toISOString()`), + teste `datetime.test.ts` (round-trip,
  e caso de fuso: mock de `Date` não é necessário — teste round-trip
  local→ISO→local).
- Criar `web/components/editor/post-settings-footer.tsx` com o bloco comum:
  legenda de feed (quando `isFeed`), select de conta, `datetime-local`, área de
  botões via `children`/props. Uploader mantém o seletor de destino (só ele
  tem); post-editor mantém badge/cancelar (só ele tem).
- Trocar os dois consumidores para usar o componente + helpers.

**Verify**: `npm run build` + `npm test` verdes; conferência visual das duas
telas se houver ambiente (`npm run dev`).

## Test plan

- `use-editor-history.test.ts` — 4 casos (Step 2).
- `web/lib/datetime.test.ts` — round-trip + formato do input.
- Suite do plano 019 continua verde (regressão de rotas).
- Manual (se ambiente): arrastar/redimensionar/rotacionar elemento, undo/redo
  via botões e teclado, wheel zoom, criar story E feed nas duas telas.

## Done criteria

- [ ] `npm run lint`, `npm test`, `npm run build` → exit 0
- [ ] `story-editor.tsx` < 300 linhas
- [ ] `grep -rn "toLocalInput" web/app` → só o import de `@/lib/datetime`
- [ ] Nenhuma mudança de comportamento declarada no diff (revisão)
- [ ] `plans/README.md` atualizado

## STOP conditions

- Plano 019 não aplicado (sem rede de testes) — reporte antes de refatorar.
- A estrutura do arquivo divergiu bastante dos números de linha de "Current
  state" (churn alto é esperado; estrutura DIFERENTE — funções sumidas/renomeadas
  — é drift real).
- Precisar de dependência nova (ex.: @testing-library/react) — reporte com a
  justificativa em vez de instalar.
- Qualquer mudança de comportamento aparecer necessária "de brinde" — não;
  registre e siga o 1:1.

## Maintenance notes

- Depois desta decomposição, features de editor (novo tipo de elemento, snap,
  guias) tocam arquivos isolados: elemento novo = layers.tsx + panels.tsx +
  story-doc.ts (+ document.py + text_overlay.py no Python — ver plano 017).
- Revisor: diff grande mas mecânico — focar em (1) dependências dos hooks
  extraídos, (2) closures que capturavam estado do componente e agora recebem
  por parâmetro.
- Follow-up deferido: testes de interação de gesto (pointer events) com
  testing-library — exige decisão de dependência.
