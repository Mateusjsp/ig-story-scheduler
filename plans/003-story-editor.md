# Plano 003 — Editor de Story (camadas: múltiplos textos + stickers)

## Objetivo
Editor tipo Instagram: adicionar vários blocos de texto (e depois emoji/stickers),
arrastar, redimensionar, girar — ao vivo no browser — e publicar o resultado.

## Mudança de modelo
Hoje: `media.caption` + `media.style` = 1 texto, placement auto/fixo, render no
server. Passa a ser um **documento de camadas**:

```jsonc
// media.doc (jsonb)
{
  "version": 1,
  "elements": [
    {
      "id": "el1",
      "type": "text",
      "text": "Torre Eiffel",
      "x": 0.5, "y": 0.4,        // centro, normalizado 0..1
      "w": 0.8,                   // largura máx normalizada (wrap)
      "rotation": -8,             // graus
      "align": "center",
      "font": "sans-bold",
      "color": "#FFFFFF",
      "size_factor": 0.07,        // fração da largura da imagem
      "scrim":   { "enabled": true, "color": "#000000", "opacity": 110, "adaptive": true },
      "outline": { "enabled": false, "color": "#000000", "width": 3 }
    }
    // ... + type:"sticker" (fase C)
  ]
}
```

`x/y/w/size/rotation` normalizados → mesmo doc renderiza em qualquer resolução
(preview client 720px, saída 1080px) idêntico.

### Fonte da verdade = server
O browser desenha **preview ao vivo** com web-fonts (mesmas TTFs). No save, o
server re-renderiza autoritativo (Pillow) a partir do `doc`. Preview client é
"quase pixel", a imagem publicada é a do server. Diferenças de wrap entre
browser/Pillow são absorvidas porque o que vale é o render server (mostrado após
salvar).

### Fidelidade de fonte (WYSIWYG)
Servir as TTFs bundladas como `@font-face` (web/public/fonts + css). Métricas do
browser ≈ Pillow com a mesma TTF. Sem isso, o preview divergiria da saída.

## Compatibilidade
- `overlay_text` legado continua (posts antigos: caption+style). 
- `process_image_bytes` aceita `doc` novo OU (caption, style) legado; se vier
  caption sem doc, embrulha em 1 elemento equivalente.
- media guarda `doc` jsonb; caption continua preenchido (texto concatenado dos
  elementos) pra listagens/busca.

---

## Fatias (cada uma deployável)

### Slice A — backbone de render por camadas (sem UI nova)
1. `image-service/app/imaging/document.py`: Pydantic `StoryDoc` + `TextElement`
   (valida x/y/w/rotation/size/cores/font).
2. `text_overlay.py`: `render_document(img, doc)` — desenha cada elemento na
   ordem: mede fonte por `size_factor*W`, faz wrap em `w*W`, monta o bloco numa
   camada RGBA transparente, aplica scrim/outline, **rotaciona** (`Image.rotate`
   expand) e cola centrado em `(x*W, y*H)`. Reusa helpers atuais (scrim adaptativo,
   stroke).
3. `media.py`: `build_story_image`/`process_image_bytes` aceitam `doc: StoryDoc`.
   Legado: caption+style → `StoryDoc.from_caption(caption, style)`.
4. `main.py`: `/preview`, `/process`, `/reprocess` aceitam Form `doc` (JSON).
   Precedência: `doc` > (caption+style). Valida → 400.
5. Migration `0008_media_doc.sql`: `alter table media add column doc jsonb`.
6. Web: `create` e `schedule/[id]` passam `doc` quando presente.
7. Servir fontes web: copiar as 4 TTFs DejaVu pra `web/public/fonts/` + css
   `@font-face` (chaves batendo com `FontKey`). (As mesmas do container.)

### Slice B — editor de camadas (texto) no browser
1. `web/lib/story-doc.ts`: tipos `StoryDoc`/`TextElement` (espelha back) +
   `DEFAULT_ELEMENT`, resolvers, concat de caption.
2. Componente `StoryCanvas` (client): fundo (blur-fill aproximado ou o preview
   server) + camadas absolutas. Cada camada:
   - arrasta (pointer events), 
   - handle de resize (canto) → ajusta `size_factor`,
   - handle de rotação → `rotation`,
   - clique seleciona; painel lateral edita fonte/cor/scrim/outline/align.
   - toolbar: + texto, duplicar, deletar, ordem (frente/trás).
   Usa web-fonts pra render fiel; posições em % (normalizado).
3. Integra no `uploader.tsx` (novo) e no `post-editor.tsx` (edição) — ambos
   produzem `doc` e mandam pro back.
4. Preview autoritativo: botão/ः debounce que chama `/api/preview` com `doc` e
   mostra a imagem server ao lado (confirma o resultado real).

### Slice C — emoji e stickers
1. Emoji de verdade: fonte `NotoColorEmoji` no container; render server com
   `embedded_color=True`. Fallback: tratar emoji como elemento `sticker` (imagem)
   pra evitar o problema de font-fallback do Pillow em strings mistas.
2. `type:"sticker"`: elemento imagem (emoji PNG / upload). Camada de imagem no
   editor (arrasta/gira/escala). Upload de sticker → Storage.
3. Biblioteca de emoji/stickers na UI.

---

## Riscos / decisões
- **Wrap divergente browser×Pillow**: mitigado por server autoritativo + preview
  real pós-save. Se incomodar, medir texto no server e devolver métricas.
- **Emoji fidelidade**: arte do emoji nativo do browser ≠ NotoColorEmoji. Aceitar
  ou padronizar via sticker PNG (Twemoji).
- **Rotação + scrim**: rotacionar a camada inteira (texto+scrim juntos) mantém o
  fundo alinhado ao texto.
- **Performance editor**: pointer events + transform CSS (translate/rotate/scale),
  sem re-render de imagem por frame. Preview server só sob demanda/debounce.
- **Tamanho das fontes no bundle web**: 4 TTFs (~1-3MB) em public/. Ok. Emoji font
  é grande (~10MB) — carregar server-side só (não web-font).

## Ordem de execução
Slice A (backbone + fontes web) → Slice B (editor texto) → Slice C (emoji/sticker).
A e B entregam o editor multi-texto tipo IG. C é incremento.
