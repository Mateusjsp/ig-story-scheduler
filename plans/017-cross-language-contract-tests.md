# Plan 017: Alinhar e travar o contrato TS↔Python do StoryDoc (defaults + fixtures)

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**: compare os excerpts de "Current state" com o
> código vivo. Divergência real = STOP.
> `git diff --stat 2db4580..HEAD -- web/lib/story-doc.ts image-service/app/imaging/document.py`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests / tech-debt
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

O documento de Story existe em duas implementações espelhadas — editor
TypeScript (`web/lib/story-doc.ts`) e renderer autoritativo Python
(`image-service/app/imaging/document.py`) — mantidas à mão. **Já divergiram**:
sticker `w` default é `0.22` no TS e `0.2` no Python; `y` inicial de texto é
`0.45` no TS e default `0.5` no Python. Hoje o editor serializa todos os campos
explicitamente, então o bug fica latente; no dia em que um campo for omitido
(doc antigo, integração nova, campo novo), preview e render final divergem
silenciosamente — o pior tipo de bug do produto ("o post não saiu como o
preview"). Não existe nenhum teste ligando os dois lados.

## Current state

- `web/lib/story-doc.ts:148-160` — factory de sticker com `w: 0.22`:
  ```ts
  export function newStickerElement(emoji: string, partial: Partial<StickerElement> = {}): StickerElement {
    ...
    return { id: `st-...`, type: "sticker", emoji, x: 0.5, y: 0.5, w: 0.22, rotation: 0, ...partial };
  }
  ```
- `web/lib/story-doc.ts:127-145` — factory de texto com `y: 0.45`, `w: 0.8`,
  `size_factor: 0.07`.
- `image-service/app/imaging/document.py:42-49` — Pydantic com
  `w: float = Field(default=0.2, ...)` no sticker; `document.py:21-34` texto com
  `y=0.5`, `w=0.8`, `size_factor=0.07`, e **bounds** (`ge/le/gt`) que o TS não
  aplica.
- Distinção importante: os defaults do Python são *fallbacks de
  desserialização* (campo ausente no JSON); os do TS são *valores iniciais de
  criação* no editor. `y: 0.45` como posição inicial de um texto novo é decisão
  de UX legítima — o problema é só o default de **desserialização** divergente
  (sticker `w`). A fixture do Step 3 trava a semântica de docs completos; o
  Step 1 alinha o único default de desserialização divergente.
- Testes existentes: `web/lib/crypto.test.ts` (vitest) e
  `image-service/tests/test_document.py` (pytest).
- Comandos: web `npm test`; python `pytest -q` (de `image-service/`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Testes web | `npm test` (em `web/`) | todos passam |
| Testes python | `pytest -q` (em `image-service/`) | todos passam |

## Scope

**In scope**:
- `web/lib/story-doc.ts` (alinhar default do sticker)
- `web/lib/story-doc.test.ts` (criar)
- `image-service/tests/test_document.py` (ampliar)
- `shared/fixtures/story-docs/*.json` (criar — diretório novo na raiz)

**Out of scope**:
- Gerar tipos de um schema único (JSON Schema/codegen) — é a solução definitiva,
  mas de custo M/L; este plano trava o contrato com testes primeiro (ver
  Maintenance notes).
- `web/lib/presets.ts` ↔ `style.py` (mesmo problema, superfície menor; segue o
  mesmo padrão depois — deferido).
- Qualquer mudança de render (`text_overlay.py`).

## Git workflow

- Branch atual (`main`), conventional commit, ex.:
  `test: shared fixtures pin the TS<->Python story-doc contract`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Alinhar o default divergente

Em `web/lib/story-doc.ts:156`, mudar `w: 0.22` → `w: 0.2` (igual ao Python).
Racional: o Python é o renderer autoritativo; 0.02 de largura é imperceptível
na criação e elimina a divergência.

**Verify**: `npm run lint` (em `web/`) → exit 0.

### Step 2: Fixtures compartilhadas

Criar `shared/fixtures/story-docs/` na raiz do repo com 3 arquivos:

1. `full.json` — doc completo: 1 texto (todos os campos, rotation 15, scrim
   enabled, outline enabled), 1 sticker (todos os campos), photo
   `{"scale": 1.6, "offset_x": 0.1, "offset_y": -0.2}`.
2. `minimal.json` — campos mínimos p/ testar defaults de desserialização:
   ```json
   {
     "version": 1,
     "elements": [
       { "type": "text", "text": "oi" },
       { "type": "sticker", "emoji": "😀" }
     ]
   }
   ```
3. `legacy-no-photo.json` — doc sem o campo `photo` (docs antigos).

### Step 3: Teste Python valida as fixtures

Em `image-service/tests/test_document.py`, adicionar:

```python
import json
from pathlib import Path

FIXTURES = Path(__file__).parent.parent.parent / "shared" / "fixtures" / "story-docs"

def test_fixtures_parse_and_defaults():
    for f in sorted(FIXTURES.glob("*.json")):
        doc = StoryDoc.model_validate_json(f.read_text(encoding="utf-8"))
        assert doc.version == 1
    minimal = StoryDoc.model_validate_json((FIXTURES / "minimal.json").read_text(encoding="utf-8"))
    text, sticker = minimal.elements
    # Defaults de desserialização — devem bater com web/lib/story-doc.test.ts
    assert (text.x, text.y, text.w, text.size_factor) == (0.5, 0.5, 0.8, 0.07)
    assert sticker.w == 0.2
    assert minimal.photo.scale == 1.0
```

**Verify**: `pytest -q` → verde.

### Step 4: Teste TS espelha as mesmas asserções

Criar `web/lib/story-doc.test.ts` (padrão `crypto.test.ts`), lendo as MESMAS
fixtures (`import fs from "node:fs"`; caminho relativo
`../../shared/fixtures/story-docs`). Asserções:

- as 3 fixtures fazem parse (`JSON.parse` + checagem estrutural de `elements`);
- `newStickerElement("😀").w === 0.2` e `newTextElement()` tem
  `w === 0.8 && size_factor === 0.07` — os mesmos números pinados no teste
  Python (se um lado mudar, o outro teste força a atualização consciente);
- `docCaption` de `full.json` retorna o texto do elemento de texto;
- `targetFromAspect`: `"4:5"→"feed_45"`, `"1:1"→"feed_11"`, `null→"story"`.

**Verify**: `npm test` → todos passam.

### Step 5: Rodar os dois lados

**Verify**: `pytest -q` (image-service) E `npm test` (web) → verdes. Esse é o
contrato: qualquer mudança de default agora quebra um dos dois lados.

## Test plan

Coberto nos Steps 3-4. Casos: parse das 3 fixtures nos dois lados; defaults de
desserialização idênticos; helpers de derivação (`docCaption`,
`targetFromAspect`).

## Done criteria

- [ ] `shared/fixtures/story-docs/{full,minimal,legacy-no-photo}.json` existem
- [ ] `pytest -q` exit 0 (fixtures validadas pelo Pydantic)
- [ ] `npm test` exit 0 (mesmos valores pinados)
- [ ] `grep -n "w: 0.22" web/lib/story-doc.ts` → sem resultado
- [ ] `git status` limpo fora do escopo
- [ ] `plans/README.md` atualizado

## STOP conditions

- Os excerpts não baterem com o código.
- O vitest não conseguir ler arquivos fora de `web/` (config de root) — antes
  de mudar config do vitest, reporte; alternativa aceitável é copiar as
  fixtures via script `pretest`, mas isso é decisão do mantenedor.
- Alguma fixture legítima falhar no Pydantic por bounds (indicaria contrato já
  quebrado em produção) — pare e reporte qual campo.

## Maintenance notes

- Campo novo no doc = atualizar `full.json`/`minimal.json` + os dois testes —
  esse é o custo aceito de não ter codegen.
- Próximo passo natural (deferido): gerar os tipos TS a partir do Pydantic
  (`pydantic2ts` ou JSON Schema) e aplicar o mesmo padrão a
  `presets.ts`↔`style.py`.
- Revisor: os números pinados nos DOIS testes devem ser idênticos — é proposital
  que estejam duplicados (cada lado quebra sozinho).
