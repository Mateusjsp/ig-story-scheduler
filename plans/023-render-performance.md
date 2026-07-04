# Plan 023: Performance do render — preview reduzido e emoji sem CDN no caminho quente

> **Executor instructions**: Siga passo a passo. Rode cada verificação antes do
> próximo passo. Condição de "STOP conditions" = pare e reporte. Ao terminar,
> atualize a linha deste plano em `plans/README.md`.
>
> **Drift check (rode primeiro)**:
> `git diff --stat 2db4580..HEAD -- image-service/app/imaging image-service/app/main.py web/app/dashboard/media/uploader.tsx`

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW/MED (preview pode divergir sutilmente do render final — ver Step 1)
- **Depends on**: none (plano 017 antes ajuda: fixtures pegam regressão de contrato)
- **Category**: perf
- **Planned at**: commit `2db4580`, 2026-07-03

## Why this matters

Dois custos evitáveis no caminho quente do render:

1. **Preview em resolução de produção**: o botão "Ver render real" roda o
   pipeline completo em 1080×1920 (LANCZOS + blur radius 40) para uma imagem
   exibida a ~200px. Latência de preview é a experiência central do editor.
2. **Emoji via CDN em tempo de render**: cada sticker de emoji ainda não
   cacheado faz `urllib.request.urlopen` SERIAL (timeout 10s) no jsDelivr
   durante o render; o cache é em memória e zera a cada deploy. CDN fora do ar
   = sticker some silenciosamente do post publicado.

## Current state

- `image-service/app/imaging/media.py:108-126` — `process_image_bytes(data,
  caption, style, doc, target)` renderiza no tamanho de `resolve_size(target)`
  tanto para `/process` quanto `/preview` (conferir assinatura exata no
  arquivo).
- `image-service/app/main.py:149-161` — `/preview` chama `_process_or_400`
  idêntico ao `/process` (sem flag de tamanho).
- `image-service/app/imaging/emoji.py` (36 linhas) — `emoji_image` com
  `@lru_cache(maxsize=512)`, fetch em
  `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/png/512/emoji_u{cps}.png`,
  falha → `None` → sticker pulado (`text_overlay.py:335-347`).
- O doc usa coordenadas normalizadas 0..1 (`document.py` docstring: "o mesmo
  doc rende igual em qualquer resolução (preview 720px, saída 1080px)") — o
  design JÁ previu preview reduzido.
- Editor web usa os MESMOS PNGs Noto no browser
  (`web/lib/story-doc.ts:109-116`, `notoUrl`), então preview do browser e
  render batem por construção de asset.
- Emojis oferecidos no editor: ver `web/lib/emoji-data.ts` (conjunto finito
  curado — isso permite vendorizar só o subconjunto).

## Commands you will need

| Purpose | Command (rodar em `image-service/`) | Expected on success |
|---------|-------------------------------------|---------------------|
| Testes | `pytest -q` | todos passam |

## Scope

**In scope**:
- `image-service/app/imaging/media.py` (parâmetro de escala do render)
- `image-service/app/main.py` (`/preview` usa escala reduzida)
- `image-service/app/imaging/emoji.py` (diretório local + fallback CDN)
- `image-service/assets/emoji/` (criar — PNGs vendorizados)
- `image-service/Dockerfile` (copiar assets)
- Script one-shot `image-service/scripts/vendor_emoji.py` (criar)
- Testes correspondentes

**Out of scope**:
- Mudar o formato/tamanho da SAÍDA de `/process` (produção continua 1080).
- Cache de imagem entre chamadas de preview (estado por sessão — complexidade
  que o ganho não paga hoje).
- `web/` (o editor já mostra preview local instantâneo; o botão "render real"
  continua batendo no servidor).

## Git workflow

- Branch atual (`main`), commits por step, ex.:
  `perf: render /preview at reduced scale`.
- Não fazer push nem abrir PR sem instrução do operador.

## Steps

### Step 1: Fator de escala no pipeline

Em `media.py`, `process_image_bytes(...)` ganha parâmetro `scale: float = 1.0`:
o tamanho final vira `(round(w*scale), round(h*scale))` do `resolve_size`.
Cuidado com os valores DERIVADOS do tamanho: blur radius, tamanhos de fonte
(`size_factor` já é fração da largura — ok por construção), espessuras de
outline/scrim no `text_overlay.py`/`document render` — tudo que for absoluto em
px precisa escalar junto ou já ser relativo. LEIA `text_overlay.py` procurando
constantes absolutas em px antes de assumir; se encontrar valor absoluto que
afeta layout (não só qualidade), liste e trate.

Em `main.py`, `/preview` chama com `scale=2/3` (720×1280 no story) e
`/process`/`/reprocess` seguem `scale=1.0`.

**Verify**: `pytest -q` → verde; teste novo: preview de fixture com target
story retorna JPEG com dimensões 720×1280 (abrir com PIL no teste).

### Step 2: Vendorizar os PNGs de emoji

- Criar `image-service/scripts/vendor_emoji.py`: lê a lista de emojis de
  `web/lib/emoji-data.ts` (parse simples por regex de literais) e baixa cada
  PNG Noto para `image-service/assets/emoji/emoji_u{cps}.png`. Rodá-lo UMA vez
  e commitar os PNGs (conjunto curado é pequeno; licença Noto Emoji = Apache 2.0,
  ok para vendorizar — citar no cabeçalho do script).
- `emoji.py`: procurar primeiro em `assets/emoji/`; só cair no CDN (com o
  timeout atual) se não existir localmente; manter o `lru_cache`.
- `Dockerfile`: garantir `COPY` dos assets.

**Verify**: `pytest -q` → verde; teste novo: com um PNG fake em
`assets/emoji/`, `emoji_image` retorna imagem SEM chamar a rede (patch em
`urllib.request.urlopen` assertando not-called).

### Step 3: Timeout do fallback

Em `emoji.py`, reduzir o timeout do fallback CDN de 10s → 3s (com assets
vendorizados, o fetch remoto é exceção, não regra; 10s serial por emoji é o
que segura o worker).

**Verify**: `pytest -q` → verde.

## Test plan

- `tests/test_api.py`: `/preview` story → JPEG 720×1280; `/process` story →
  1080×1920 (inalterado).
- `tests/` novo p/ emoji: hit local sem rede; miss local → tenta CDN (mock).
- Se plano 017 aplicado: fixtures continuam passando (contrato intacto).

## Done criteria

- [ ] `pytest -q` exit 0 com os testes novos
- [ ] `/preview` retorna dimensão reduzida; `/process` inalterado (testes provam)
- [ ] `assets/emoji/` commitado com os PNGs do conjunto do editor
- [ ] `emoji_image` não acessa rede para emoji vendorizado (teste prova)
- [ ] `git status` limpo fora do escopo
- [ ] `plans/README.md` atualizado

## STOP conditions

- `text_overlay.py` tiver constantes absolutas em px que afetam LAYOUT (posição
  de quebra de linha, etc.) — o preview reduzido divergiria do final; pare e
  reporte a lista antes de escalar na marra.
- O parse de `emoji-data.ts` no script for frágil demais (formato inesperado) —
  reporte; alternativa é lista manual, decisão do mantenedor.
- Os PNGs somarem tamanho absurdo (>20 MB) — reporte antes de commitar binários.

## Maintenance notes

- Emoji novo no editor (`emoji-data.ts`) ⇒ rodar `scripts/vendor_emoji.py` de
  novo e commitar o PNG — documentar no próprio script.
- Se o preview "não bater" com o publicado em relato de usuário, primeiro
  suspeito é o Step 1 (alguma constante absoluta escapou).
- Revisor: conferir que `/reprocess` ficou em `scale=1.0` (ele gera a imagem
  PUBLICADA).
