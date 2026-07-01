# Plano 009 — Publicar no Feed (foto, carrossel, reel) além de Story

## Objetivo
Permitir agendar/publicar no **feed** do Instagram, não só story. Reusa toda a
infra existente (OAuth, token, fila `posts`, claim atômico, scheduler). Sem scope
novo, sem App Review, sem reconexão — `instagram_business_content_publish` (que o
app já pede) cobre feed E story.

> **Diferença do Plano 008 (webhook)**: aquele precisava scope novo + App Review +
> reconexão. Feed **não precisa de nada disso** — funciona com o que já está no ar.

---

## Estado atual (verificado no código)
- Publisher só faz story: `media_type=STORIES` hardcoded —
  [graph_api.py:51](../image-service/app/publishing/graph_api.py#L51). Método único
  `publish_story()`.
- Render trava 9:16: `STORY_SIZE=(1080,1920)` —
  [media.py:24](../image-service/app/imaging/media.py#L24). `build_story_image` sempre
  faz blur-fill pra 9:16; `/preview`, `/process`, `/reprocess`, `_publish_one` todos
  assumem story.
- `posts` **não tem** coluna de tipo/destino —
  [0001:92-105](../supabase/migrations/0001_init.sql#L92-L105). `media` tem `caption`
  (derivada do texto do doc) + `doc` jsonb + `processed_url`.
- `_publish_one` chama `publisher.publish_story(image_url)` fixo —
  [scheduler.py:87](../image-service/app/scheduler.py#L87).
- Editor web é 9:16 ([story-editor.tsx](../web/components/story-editor.tsx)); `create`
  manda `doc`/`caption`/`style` pro `/process` —
  [create/route.ts](../web/app/api/media/create/route.ts).

---

## Formatos de feed (Meta)
| Destino | `media_type` | Proporção saída | Campos API |
|---------|-------------|------------------|------------|
| Story (hoje) | `STORIES` | 1080×1920 (9:16) | `image_url` |
| Feed foto | *(omitir)* IMAGE | 1080×1350 (4:5) ou 1080×1080 (1:1) | `image_url`, `caption` |
| Feed reel | `REELS` | 1080×1920 (9:16) | `video_url`, `caption`, `cover_url` |
| Carrossel | `CAROUSEL` | 1:1 ou 4:5, N itens | filhos `is_carousel_item=true` |

Decisão de escopo: **fase 1 = feed foto (single) 4:5 e 1:1**. Reel (vídeo) e carrossel
= fases seguintes (vídeo é outro pipeline; carrossel é multi-container).

**Caption real**: no feed, `caption` é texto de verdade na API (hashtag/@/quebra de
linha), separado da imagem. Diferente do story, onde o texto é queimado no pixel. →
precisa de um campo de legenda de texto **separado** do doc de overlay.

---

# ┌─────────────────────────────────────────┐
# │  PARTE 1 — O QUE É SEU (manual, você faz) │
# └─────────────────────────────────────────┘

Quase nada — é a vantagem do feed sobre o webhook.

## S1 — Nada na Meta
Sem scope novo, sem App Review, sem business verification extra, sem reconectar contas.
Já está tudo autorizado.

## S2 — Aplicar migration no Supabase
- Rodar `0011_post_target.sql` (não há projeto live no repo pra eu aplicar).

## S3 — Testar de verdade (pós-código)
- Agendar 1 foto pro feed numa conta de teste → conferir que sai como post permanente
  (não story), na proporção certa, com a legenda de texto.
- Limite Meta: 25 posts/24h por conta (story + feed **somam**). Carrossel conta 1.

---

# ┌──────────────────────────────────────────┐
# │  PARTE 2 — O QUE É MEU (código, eu faço)   │
# └──────────────────────────────────────────┘

## Fase F0 — Publisher genérico (back, sem UI)
Deployável; não muda nada até a UI mandar feed.
- [ ] `graph_api.py`: generalizar. `publish(image_url, media_type, caption=None)` monta o
      container conforme o tipo (`STORIES` sem caption; feed com `caption` e sem
      `media_type`, ou `REELS`). Manter `publish_story()` como wrapper fino
      (compatibilidade com o scheduler atual). Não quebrar assinatura existente.
- [ ] `base.py`: expandir contrato `Publisher` (ou add método `publish_feed`).
- [ ] Testes: `test_api.py`/novo — container de feed manda `caption` + omite
      `media_type`; story continua `STORIES`.

## Fase F1 — Render multi-proporção (back)
- [ ] `media.py`: extrair `STORY_SIZE` pra um mapa de tamanhos por destino:
      `story=(1080,1920)`, `feed_45=(1080,1350)`, `feed_11=(1080,1080)`.
      `build_story_image` → `build_image(img, size, ...)` parametrizado; blur-fill e
      `_cover` já funcionam pra qualquer `size`.
- [ ] `document.py`/`text_overlay.py`: `render_document` usa coords normalizadas
      (0..1) — já é agnóstico de proporção. Confirmar que scrim/rotação batem em 4:5 e
      1:1 (testar). Overlay de texto no feed é **opcional** (pode ter foto limpa +
      caption de texto).
- [ ] `main.py`: `/preview`, `/process`, `/reprocess` aceitam Form `target`
      (`story`|`feed_45`|`feed_11`), default `story`. Retorno `width`/`height` conforme
      o alvo. Validar → 400.

## Fase F2 — Schema + fila (banco)
- [ ] Migration `0011_post_target.sql`:
      ```sql
      create type post_target as enum ('story', 'feed');
      alter table posts add column target post_target not null default 'story';
      alter table media add column feed_caption text;   -- legenda de texto real (feed)
      alter table media add column aspect text;          -- '9:16' | '4:5' | '1:1'
      ```
- [ ] `scheduler._publish_one`: ler `post.target` + `media.feed_caption` +
      `media.aspect`; chamar `publisher.publish(url, media_type, caption)` conforme o
      destino, em vez de `publish_story` fixo —
      [scheduler.py:87](../image-service/app/scheduler.py#L87).

## Fase F3 — UI (web)
- [ ] `create/route.ts`: aceitar `target` + `feed_caption` + `aspect` no form; repassar
      `target` pro `/process`; gravar em `media`/`posts` —
      [create/route.ts](../web/app/api/media/create/route.ts).
- [ ] Editor: seletor de destino (Story / Feed) no
      [uploader.tsx](../web/app/dashboard/media/uploader.tsx). Ao escolher feed: muda a
      moldura do canvas (4:5 ou 1:1) e mostra um campo de **legenda de texto**
      (feed_caption) separado dos overlays. O `story-editor` precisa aceitar `aspect`
      variável (hoje 9:16 fixo) — parametrizar dimensão do canvas.
- [ ] `schedule/[id]` (edição) + `/reprocess`: mesmo `target`/`aspect` na reedição.
- [ ] Listagens (`posts`, calendário): badge Story vs Feed.

## Fase F4 — Reel + carrossel (opcional, depois)
- [ ] Reel: upload de vídeo → `video_url` + `cover_url` (pipeline de vídeo novo,
      Storage de vídeo, poll de status mais longo). Escopo grande — plano à parte.
- [ ] Carrossel: N mídias → N containers filhos → 1 container pai `CAROUSEL` → publish.

---

## Riscos / decisões
- **Editor 9:16 hardcoded**: o [story-editor.tsx](../web/components/story-editor.tsx) e o
  render assumem 9:16. Parametrizar proporção é o maior trabalho da UI (F3). Coords
  normalizadas do doc ajudam — a lógica de posição não muda, só o frame.
- **Legenda: texto real vs queimada**: feed usa `caption` de texto na API. Manter os
  dois caminhos — overlay visual (doc, opcional no feed) + `feed_caption` (texto real).
  Não confundir com `media.caption` atual (que é derivada do doc pra busca).
- **Proporção da foto**: story faz blur-fill (foto inteira + fundo borrado). Feed 4:5
  pode manter blur-fill **ou** crop-cover. Decisão de produto — sugiro blur-fill pra
  consistência, com opção de crop depois.
- **Limite 25/dia somado**: story + feed dividem a cota. Se o volume subir, o rate limit
  do 008/README vira real. Fora de escopo aqui, mas anotado.
- **Compatibilidade**: `target default 'story'` + `publish_story()` wrapper garantem que
  todo post/fluxo existente continua idêntico. Feed é aditivo.

## Ordem de execução
**F0 (publisher)** → **F1 (render)** → **F2 (schema+fila)** → **F3 (UI)**. F0–F2 são
back e testáveis sem UI (dá pra publicar feed via post inserido à mão). F3 abre pro
usuário. F4 (reel/carrossel) é incremento com planos próprios.

## Dependências / bloqueadores
- Nenhum externo. Só a migration aplicada no Supabase (S2).

## Esforço
- F0: **S** · F1: **M** · F2: **S** · F3: **M/L** (editor multi-proporção) · F4: **L**
  (vídeo, plano à parte).
