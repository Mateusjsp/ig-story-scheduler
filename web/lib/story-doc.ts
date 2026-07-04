// Documento de Story em camadas (espelha image-service/app/imaging/document.py).
// O editor produz este doc; o server re-renderiza autoritativo.

import {
  DEFAULT_STYLE,
  type FontKey,
  type Outline,
  type Scrim,
} from "@/lib/presets";

export type Align = "left" | "center" | "right";

// Destino da publicação + proporção do frame. `target` casa com o Form do
// image-service (resolve_size) e `postTarget` com o enum post_target do banco.
export type Target = "story" | "feed_45" | "feed_11";

export interface TargetMeta {
  label: string;
  w: number; // proporção (largura)
  h: number; // proporção (altura)
  css: string; // valor de aspect-ratio no CSS
  aspectLabel: string; // rótulo humano ('9:16')
  postTarget: "story" | "feed"; // enum no banco (posts.target)
  isFeed: boolean;
}

export const TARGETS: Record<Target, TargetMeta> = {
  story: {
    label: "Story",
    w: 9,
    h: 16,
    css: "9 / 16",
    aspectLabel: "9:16",
    postTarget: "story",
    isFeed: false,
  },
  feed_45: {
    label: "Feed · retrato",
    w: 4,
    h: 5,
    css: "4 / 5",
    aspectLabel: "4:5",
    postTarget: "feed",
    isFeed: true,
  },
  feed_11: {
    label: "Feed · quadrado",
    w: 1,
    h: 1,
    css: "1 / 1",
    aspectLabel: "1:1",
    postTarget: "feed",
    isFeed: true,
  },
};

export interface TextElement {
  id: string;
  type: "text";
  text: string;
  x: number; // centro X normalizado 0..1
  y: number; // centro Y normalizado 0..1
  w: number; // largura máx (wrap), fração da largura 0..1
  rotation: number; // graus, positivo = horário
  align: Align;
  font: FontKey;
  color: string; // #RRGGBB
  size_factor: number; // fração da largura
  scrim: Scrim;
  outline: Outline;
}

export interface StickerElement {
  id: string;
  type: "sticker";
  emoji: string; // caractere(s) do emoji; render usa o PNG Noto
  x: number;
  y: number;
  w: number; // largura do sticker, fração da largura
  rotation: number;
}

export type Element = TextElement | StickerElement;

// Enquadramento da foto (crop/zoom/pan). scale=1 = ajustar (foto inteira + blur).
export interface Photo {
  scale: number; // >=1
  offset_x: number; // fração da largura do frame, -1..1
  offset_y: number;
}

export const DEFAULT_PHOTO: Photo = { scale: 1, offset_x: 0, offset_y: 0 };

export interface StoryDoc {
  version: number;
  photo?: Photo;
  elements: Element[];
}

// Rótulo de aspecto guardado em media.aspect -> chave de Target (pra reprocessar
// na proporção certa). Ausente/desconhecido -> story.
export function targetFromAspect(aspect: string | null | undefined): Target {
  if (aspect === "4:5") return "feed_45";
  if (aspect === "1:1") return "feed_11";
  return "story";
}

// URL do PNG do emoji (Noto 512) — o server usa o mesmo asset, então bate.
export function notoUrl(emoji: string): string {
  const cps = [...emoji]
    .map((c) => c.codePointAt(0)!)
    .filter((cp) => cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join("_");
  return `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/png/512/emoji_u${cps}.png`;
}

// Chave de fonte -> família CSS (@font-face em globals.css).
export const FONT_CSS: Record<FontKey, string> = {
  "sans-bold": "story-sans-bold",
  serif: "story-serif",
  condensed: "story-condensed",
  mono: "story-mono",
};

let _seq = 0;
export function newTextElement(partial: Partial<TextElement> = {}): TextElement {
  _seq += 1;
  return {
    id: `el-${Date.now()}-${_seq}`,
    type: "text",
    text: "Toque pra editar",
    x: 0.5,
    y: 0.45,
    w: 0.8,
    rotation: 0,
    align: "center",
    font: "sans-bold",
    color: DEFAULT_STYLE.text_color,
    size_factor: 0.07,
    scrim: { ...DEFAULT_STYLE.scrim },
    outline: { ...DEFAULT_STYLE.outline },
    ...partial,
  };
}

let _sseq = 0;
export function newStickerElement(emoji: string, partial: Partial<StickerElement> = {}): StickerElement {
  _sseq += 1;
  return {
    id: `st-${Date.now()}-${_sseq}`,
    type: "sticker",
    emoji,
    x: 0.5,
    y: 0.5,
    w: 0.2, // igual ao default de desserialização do Python (document.py)
    rotation: 0,
    ...partial,
  };
}

export function emptyDoc(): StoryDoc {
  return { version: 1, elements: [] };
}

/** Texto concatenado dos elementos de texto — pra guardar em media.caption. */
export function docCaption(doc: StoryDoc): string {
  return doc.elements
    .filter((e): e is TextElement => e.type === "text")
    .map((e) => e.text.trim())
    .filter(Boolean)
    .join("\n");
}

/** Doc inicial ao editar um post legado (só caption+style): 1 elemento centrado. */
export function docFromLegacy(
  caption: string | null | undefined,
  style: import("@/lib/presets").StyleConfig | null | undefined,
): StoryDoc {
  if (!caption || !caption.trim()) return emptyDoc();
  const s = style ?? DEFAULT_STYLE;
  return {
    version: 1,
    elements: [
      newTextElement({
        text: caption,
        font: s.font,
        color: s.text_color,
        size_factor: s.size_factor,
        scrim: { ...s.scrim },
        outline: { ...s.outline },
        y: 0.5,
      }),
    ],
  };
}
