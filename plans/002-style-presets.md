# Plano 002 — Style Presets (custom por usuário)

## Objetivo
Usuário cria, salva e reutiliza presets de estilo do caption (cor, fonte, scrim,
posição/tamanho). Ao enviar uma foto, escolhe um preset; o texto é desenhado com
esse estilo no `/process`.

## Princípio de arquitetura
O `image-service` **continua stateless** quanto a presets. O post já é processado
no momento do CREATE (imagem final gravada no Storage, `processed_url`), então o
estilo é "baked" ali — não precisa guardar referência do preset pra publicar
depois. Logo:

- Tabela de presets vive **só no web + Supabase**.
- O front **resolve** o preset pra um objeto `style` (JSON) e manda pro
  `/preview` e `/process`.
- `image-service` recebe `style` como um campo Form (JSON string), valida e aplica.

Isso mantém o serviço de imagem burro/testável e evita acoplar publicação a
lookup de preset.

---

## 1. Schema do `style` (contrato compartilhado)

JSON enviado ao image-service. Todos campos opcionais; ausência = default
(estilo "classic" atual, pra não quebrar posts sem preset).

```jsonc
{
  "font": "sans-bold",          // chave -> TTF bundlada. enum abaixo
  "text_color": "#FFFFFF",      // hex
  "scrim": {                     // caixa sombreada atrás do texto
    "enabled": true,
    "color": "#000000",
    "opacity": 110,             // 0-255 (hoje é adaptativo 110/160)
    "adaptive": true            // se true, ignora opacity e mede luminância (comportamento atual)
  },
  "outline": {                   // contorno no texto (alternativa ao scrim)
    "enabled": false,
    "color": "#000000",
    "width": 3
  },
  "position": "auto",           // auto | top | center | bottom
  "size_factor": 0.066          // fração da largura (hoje fixo 0.066)
}
```

### Enum de fontes (bundlar TTFs no repo)
`image-service/app/imaging/fonts/`:
- `sans-bold`   → DejaVuSans-Bold.ttf (default, atual)
- `serif`       → um serif bold (ex.: NotoSerif-Bold)
- `condensed`   → um condensed (ex.: Oswald / Barlow Condensed)
- `handwriting` → opcional, estilo casual

Bundlar no repo (não depender de fonte de sistema) resolve de vez o bug de fonte
ausente no container. `_FONT_CANDIDATES` deixa de ser fallback de sistema e passa
a apontar pro dir bundlado. Manter STORY_FONT_PATH como override.

---

## 2. Backend (image-service)

### 2.1 `StyleConfig` (Pydantic)
Novo `app/imaging/style.py`: modelo Pydantic com defaults = estilo classic.
Método `.font_path()` mapeia `font` enum → caminho TTF bundlado (rejeita
desconhecido). Valida hex, ranges.

### 2.2 `overlay_text(img, text, style: StyleConfig)`
Parametrizar [text_overlay.py](../image-service/app/imaging/text_overlay.py):
- `_load_font` usa `style.font_path()` + `size_factor`.
- cor do texto = `style.text_color`.
- scrim: se `outline.enabled`, desenha contorno (stroke) e pula scrim; senão
  desenha rounded_rectangle com `scrim.color`/opacity (adaptive mantém a lógica
  atual de luminância).
- posição: se `position != auto`, pula `_pick_y`/busyness e usa banda fixa
  (top ≈ SAFE_TOP, center ≈ meio da zona segura, bottom ≈ SAFE_BOTTOM - block_h).
  `auto` mantém placement inteligente + face-avoidance.

Stroke do texto: PIL `draw.text(..., stroke_width, stroke_fill)`.

### 2.3 `build_story_image` / `process_image_bytes`
Passar `style` adiante (default classic se None) —
[media.py](../image-service/app/imaging/media.py).

### 2.4 Endpoints
[main.py](../image-service/app/main.py) `/preview` e `/process`: novo Form field
`style: str | None`. Parse JSON → `StyleConfig` (`StyleConfig()` se ausente).
Erro de parse → 400.

---

## 3. Supabase (migration nova)

`supabase/migrations/0005_style_presets.sql`:

```sql
create table style_presets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null,
  config jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table style_presets enable row level security;
create policy "owner rw" on style_presets
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
create index on style_presets(owner);
-- opcional: parcial unique pra 1 default por usuário
create unique index one_default_per_owner on style_presets(owner)
  where is_default;
```

Seed opcional: inserir presets "starter" (classic, bold-yellow, minimal) por
usuário no primeiro acesso, ou tratar como presets embutidos no front.

---

## 4. Web API (CRUD de presets)

`web/app/api/presets/route.ts` (GET lista, POST cria) +
`web/app/api/presets/[id]/route.ts` (PUT, DELETE). Todos via Supabase server
client com RLS (owner-only, igual aos outros). Validar `config` contra o mesmo
schema (zod) antes de gravar.

Alterar:
- [create route](../web/app/api/media/create/route.ts): ler `style` do form e
  append no FormData pro `/process` (linha ~54).
- [preview route](../web/app/api/preview/route.ts): já faz proxy do form inteiro
  — nada a mudar, o front só adiciona `style`.

---

## 5. Frontend

### 5.1 Tipos + resolver
`web/lib/presets.ts`: tipo `StyleConfig` (zod), presets embutidos (classic etc.)
e helper que resolve preset selecionado → objeto style.

### 5.2 Gerenciador de presets (nova página/modal)
`web/app/dashboard/presets/`: lista presets do usuário, criar/editar com:
- color picker (texto, scrim/outline)
- select de fonte (preview do nome renderizado)
- toggle scrim vs outline + sliders (opacity/width)
- select de posição, slider de tamanho
- **preview ao vivo**: reusa `/api/preview` mandando uma imagem de amostra +
  `style` atual (debounced). Mostra resultado real do image-service.

### 5.3 Uploader
[uploader.tsx](../web/app/dashboard/media/uploader.tsx):
- dropdown "Estilo" listando presets (embutidos + do usuário).
- ao rodar preview/submit, resolve preset → append `style` (JSON) no FormData
  em `runPreview` (linha ~28) e `submit` (linha ~55).
- default = preset marcado `is_default` ou "classic".

---

## 6. Ordem de execução sugerida
1. Bundlar fontes + `StyleConfig` + parametrizar `overlay_text` (backend puro,
   testável isolado). Manter default = classic → zero regressão.
2. Endpoints aceitam `style`. Testes de snapshot por preset.
3. Migration + CRUD API + RLS.
4. Front: resolver + dropdown no uploader (presets embutidos só). Já entrega
   valor sem UI de builder.
5. Front: página de gerenciador com preview ao vivo (custom presets).

Fatiar assim deixa cada etapa deployável. Etapas 1-2 já permitem presets fixos;
3-5 entregam o custom por usuário.

## 7. Riscos / decisões abertas
- **Licença das fontes** bundladas — usar fontes com licença livre (DejaVu, Noto,
  Google Fonts OFL). Evitar Arial (proprietária) no repo.
- **Tamanho do repo/imagem** — cada TTF ~300KB-1MB. 3-4 fontes ok.
- **Preview ao vivo** custa uma chamada ao image-service por ajuste — debounce
  (~400ms) e imagem de amostra pequena.
- **Validação de contraste** — deixar usuário escolher combos ruins (texto claro
  sem scrim em fundo claro) ou avisar? Fase 2.
