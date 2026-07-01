"use client";

import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  FONT_CSS,
  newStickerElement,
  newTextElement,
  notoUrl,
  type Element,
  type StickerElement,
  type StoryDoc,
  type TextElement,
} from "@/lib/story-doc";
import { FONT_LABELS, type FontKey } from "@/lib/presets";
import { EmojiPicker } from "@/components/emoji-picker";

// Editor de Story em camadas: fundo (blur-fill aproximado por CSS) + textos e
// emojis arrastáveis/redimensionáveis/rotacionáveis, ao vivo com os mesmos assets
// do render. Controlado: recebe `doc` e emite `onChange`. Server re-renderiza no save.

// patch frouxo: campos de texto ou sticker (merge por id; type nunca é alterado).
type Patch = Record<string, unknown>;

type Gesture =
  | { kind: "move"; id: string; ox: number; oy: number; sx: number; sy: number }
  | { kind: "rotate"; id: string; cx: number; cy: number; start: number; base: number }
  | { kind: "resize"; id: string; cx: number; cy: number; dist: number; base: number; field: "size_factor" | "w" };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function StoryEditor({
  doc,
  onChange,
  bgSrc,
  footer,
}: {
  doc: StoryDoc;
  onChange: (d: StoryDoc) => void;
  bgSrc: string | null;
  footer?: React.ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selected = doc.elements.find((e) => e.id === selectedId) ?? null;

  function update(id: string, patch: Patch) {
    onChange({
      ...doc,
      elements: doc.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as Element) : e)),
    });
  }

  function addText() {
    const el = newTextElement();
    onChange({ ...doc, elements: [...doc.elements, el] });
    setSelectedId(el.id);
  }

  function addSticker(emoji: string) {
    const el = newStickerElement(emoji);
    onChange({ ...doc, elements: [...doc.elements, el] });
    setSelectedId(el.id);
    setPickerOpen(false);
  }

  function duplicate(id: string) {
    const src = doc.elements.find((e) => e.id === id);
    if (!src) return;
    const el: Element = { ...src, id: `${src.type}-${Date.now()}`, x: clamp(src.x + 0.05, 0, 1), y: clamp(src.y + 0.05, 0, 1) };
    onChange({ ...doc, elements: [...doc.elements, el] });
    setSelectedId(el.id);
  }

  function remove(id: string) {
    onChange({ ...doc, elements: doc.elements.filter((e) => e.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }

  function reorder(id: string, dir: 1 | -1) {
    const i = doc.elements.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= doc.elements.length) return;
    const els = [...doc.elements];
    [els[i], els[j]] = [els[j], els[i]];
    onChange({ ...doc, elements: els });
  }

  function rect() {
    return stageRef.current!.getBoundingClientRect();
  }

  function onPointerDownBody(e: RPointerEvent, el: Element) {
    e.stopPropagation();
    setSelectedId(el.id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind: "move", id: el.id, ox: el.x, oy: el.y, sx: e.clientX, sy: e.clientY };
  }

  function onPointerDownRotate(e: RPointerEvent, el: Element) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const r = rect();
    const cx = r.left + el.x * r.width;
    const cy = r.top + el.y * r.height;
    const start = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    gesture.current = { kind: "rotate", id: el.id, cx, cy, start, base: el.rotation };
  }

  function onPointerDownResize(e: RPointerEvent, el: Element) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const r = rect();
    const cx = r.left + el.x * r.width;
    const cy = r.top + el.y * r.height;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    const field = el.type === "text" ? "size_factor" : "w";
    const base = el.type === "text" ? el.size_factor : el.w;
    gesture.current = { kind: "resize", id: el.id, cx, cy, dist, base, field };
  }

  function onPointerMove(e: RPointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const r = rect();
    if (g.kind === "move") {
      update(g.id, {
        x: clamp(g.ox + (e.clientX - g.sx) / r.width, 0, 1),
        y: clamp(g.oy + (e.clientY - g.sy) / r.height, 0, 1),
      });
    } else if (g.kind === "rotate") {
      const ang = Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * (180 / Math.PI);
      let rot = g.base + (ang - g.start);
      rot = ((rot + 180) % 360 + 360) % 360 - 180; // normaliza -180..180
      update(g.id, { rotation: Math.round(rot) });
    } else if (g.kind === "resize") {
      const d = Math.hypot(e.clientX - g.cx, e.clientY - g.cy);
      const val = clamp((g.base * d) / g.dist, 0.02, g.field === "w" ? 1 : 0.3);
      update(g.id, { [g.field]: val });
    }
  }

  function onPointerUp() {
    gesture.current = null;
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* palco: foto grande, ocupa a altura da tela */}
      <div className="flex justify-center">
        <div
          ref={stageRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerDown={() => setSelectedId(null)}
          style={{ containerType: "inline-size" }}
          className="relative aspect-[9/16] h-[74vh] max-h-[820px] max-w-full touch-none select-none overflow-hidden rounded-[1.75rem] border-2 border-border bg-bg-raised shadow-2xl"
        >
          {/* fundo blur-fill aproximado (bate com o server: cover borrado + contain nítido) */}
          {bgSrc && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bgSrc} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bgSrc} alt="Foto" className="absolute inset-0 h-full w-full object-contain" />
            </>
          )}
          {!bgSrc && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-text-faint">
              escolha uma foto
            </div>
          )}

          {doc.elements.map((el) =>
            el.type === "text" ? (
              <TextLayer
                key={el.id}
                el={el}
                selected={el.id === selectedId}
                onBody={(e) => onPointerDownBody(e, el)}
                onRotate={(e) => onPointerDownRotate(e, el)}
                onResize={(e) => onPointerDownResize(e, el)}
                onDelete={() => remove(el.id)}
              />
            ) : (
              <StickerLayer
                key={el.id}
                el={el}
                selected={el.id === selectedId}
                onBody={(e) => onPointerDownBody(e, el)}
                onRotate={(e) => onPointerDownRotate(e, el)}
                onResize={(e) => onPointerDownResize(e, el)}
                onDelete={() => remove(el.id)}
              />
            ),
          )}
        </div>
      </div>

      {/* coluna de controles: ferramentas + propriedades + ajustes do post */}
      <div className="space-y-4">
        <div className="relative flex flex-wrap gap-2">
          <button type="button" onClick={addText} className={btnCls}>+ Texto</button>
          <button type="button" onClick={() => setPickerOpen((v) => !v)} className={btnCls}>+ Emoji</button>
          {selected && (
            <>
              <button type="button" onClick={() => duplicate(selected.id)} className={btnCls}>Duplicar</button>
              <button type="button" onClick={() => reorder(selected.id, 1)} className={btnCls}>Frente</button>
              <button type="button" onClick={() => reorder(selected.id, -1)} className={btnCls}>Trás</button>
            </>
          )}
          {pickerOpen && (
            <div className="absolute left-0 top-9 z-20">
              <EmojiPicker onPick={addSticker} onClose={() => setPickerOpen(false)} />
            </div>
          )}
        </div>

        {selected?.type === "text" ? (
          <ElementPanel el={selected} onChange={(p) => update(selected.id, p)} />
        ) : selected?.type === "sticker" ? (
          <StickerPanel el={selected} onChange={(p) => update(selected.id, p)} />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-faint">
            Toque em <span className="text-amber">+ Texto</span> ou{" "}
            <span className="text-amber">+ Emoji</span>. Arraste na foto pra posicionar,
            use as alças pra girar e redimensionar.
          </p>
        )}

        {footer && <div className="space-y-4 border-t border-border pt-4">{footer}</div>}
      </div>
    </div>
  );
}

const btnCls =
  "rounded-full border border-border px-3 py-1 text-xs text-text-dim transition-colors hover:border-amber hover:text-amber";

function textShadow(el: TextElement): string | undefined {
  if (!el.outline.enabled || el.outline.width <= 0) return undefined;
  const w = el.outline.width;
  const c = el.outline.color;
  // aproxima o stroke do Pillow com múltiplas sombras
  return [
    `${w}px 0 ${c}`, `-${w}px 0 ${c}`, `0 ${w}px ${c}`, `0 -${w}px ${c}`,
    `${w}px ${w}px ${c}`, `-${w}px -${w}px ${c}`, `${w}px -${w}px ${c}`, `-${w}px ${w}px ${c}`,
  ].join(", ");
}

function TextLayer({
  el,
  selected,
  onBody,
  onRotate,
  onResize,
  onDelete,
}: {
  el: TextElement;
  selected: boolean;
  onBody: (e: RPointerEvent) => void;
  onRotate: (e: RPointerEvent) => void;
  onResize: (e: RPointerEvent) => void;
  onDelete: () => void;
}) {
  const scrimBg =
    el.scrim.enabled
      ? hexA(el.scrim.color, el.scrim.adaptive ? 0.43 : el.scrim.opacity / 255)
      : "transparent";
  return (
    <div
      onPointerDown={onBody}
      style={{
        position: "absolute",
        left: `${el.x * 100}%`,
        top: `${el.y * 100}%`,
        width: `${el.w * 100}%`,
        transform: `translate(-50%, -50%) rotate(${el.rotation}deg)`,
        fontFamily: `"${FONT_CSS[el.font]}", sans-serif`,
        fontSize: `calc(${el.size_factor} * 100cqw)`,
        lineHeight: 1.15,
        color: el.color,
        textAlign: el.align,
        textShadow: textShadow(el),
        background: scrimBg,
        borderRadius: "0.4em",
        padding: "0.3em 0.5em",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        cursor: "move",
        outline: selected ? "1px solid rgba(240,136,62,0.9)" : "none",
      }}
    >
      {el.text || " "}
      {selected && <Handles onRotate={onRotate} onResize={onResize} onDelete={onDelete} />}
    </div>
  );
}

function StickerLayer({
  el,
  selected,
  onBody,
  onRotate,
  onResize,
  onDelete,
}: {
  el: StickerElement;
  selected: boolean;
  onBody: (e: RPointerEvent) => void;
  onRotate: (e: RPointerEvent) => void;
  onResize: (e: RPointerEvent) => void;
  onDelete: () => void;
}) {
  return (
    <div
      onPointerDown={onBody}
      style={{
        position: "absolute",
        left: `${el.x * 100}%`,
        top: `${el.y * 100}%`,
        width: `${el.w * 100}%`,
        transform: `translate(-50%, -50%) rotate(${el.rotation}deg)`,
        cursor: "move",
        outline: selected ? "1px solid rgba(240,136,62,0.9)" : "none",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={notoUrl(el.emoji)} alt={el.emoji} draggable={false} className="pointer-events-none block w-full" />
      {selected && <Handles onRotate={onRotate} onResize={onResize} onDelete={onDelete} />}
    </div>
  );
}

function Handles({
  onRotate,
  onResize,
  onDelete,
}: {
  onRotate: (e: RPointerEvent) => void;
  onResize: (e: RPointerEvent) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <span
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onDelete();
        }}
        title="Remover"
        style={{ ...handleStyle(0, "0%", "pointer"), background: "#e0492f", color: "#fff" }}
      >
        ×
      </span>
      <span onPointerDown={onRotate} title="Girar" style={handleStyle(-26, "50%", "grab")}>⟳</span>
      <span onPointerDown={onResize} title="Redimensionar" style={handleStyle("100%", "100%", "nwse-resize")}>⤡</span>
    </>
  );
}

function handleStyle(top: number | string, left: string, cursor: string): React.CSSProperties {
  return {
    position: "absolute",
    top: typeof top === "number" ? `${top}px` : top,
    left,
    transform: "translate(-50%, -50%)",
    width: 22,
    height: 22,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "9999px",
    background: "#f0883e",
    color: "#100d0b",
    fontSize: 13,
    cursor,
    touchAction: "none",
  };
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const FONTS = Object.keys(FONT_LABELS) as FontKey[];
const inputCls =
  "w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-sm text-text focus:border-amber focus:outline-none";

function StickerPanel({
  el,
  onChange,
}: {
  el: StickerElement;
  onChange: (p: Partial<StickerElement>) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface/30 p-4">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={notoUrl(el.emoji)} alt={el.emoji} className="h-10 w-10" />
        <span className="text-sm text-text-dim">Emoji selecionado</span>
      </div>
      <label className="flex items-center gap-2 text-sm text-text-dim">
        Tamanho
        <input type="range" min={0.08} max={0.6} step={0.01} value={el.w} onChange={(e) => onChange({ w: Number(e.target.value) })} className="flex-1 accent-amber" />
      </label>
      <label className="flex items-center gap-2 text-sm text-text-dim">
        Rotação
        <input type="range" min={-180} max={180} value={el.rotation} onChange={(e) => onChange({ rotation: Number(e.target.value) })} className="flex-1 accent-amber" />
      </label>
    </div>
  );
}

function ElementPanel({
  el,
  onChange,
}: {
  el: TextElement;
  onChange: (p: Partial<TextElement>) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface/30 p-4">
      <textarea
        value={el.text}
        onChange={(e) => onChange({ text: e.target.value })}
        rows={2}
        className="w-full resize-none rounded-md border border-border bg-surface/60 px-3 py-2 text-sm text-text focus:border-amber focus:outline-none"
        placeholder="Texto"
      />
      <div className="grid grid-cols-2 gap-2">
        <select value={el.font} onChange={(e) => onChange({ font: e.target.value as FontKey })} className={inputCls}>
          {FONTS.map((f) => (
            <option key={f} value={f} className="bg-bg-raised">{FONT_LABELS[f]}</option>
          ))}
        </select>
        <select value={el.align} onChange={(e) => onChange({ align: e.target.value as TextElement["align"] })} className={inputCls}>
          <option value="left" className="bg-bg-raised">Esquerda</option>
          <option value="center" className="bg-bg-raised">Centro</option>
          <option value="right" className="bg-bg-raised">Direita</option>
        </select>
      </div>
      <div className="flex items-center gap-3 text-sm text-text-dim">
        <label className="flex items-center gap-2">
          Cor
          <input type="color" value={el.color} onChange={(e) => onChange({ color: e.target.value.toUpperCase() })} className="h-8 w-9 rounded border border-border bg-transparent" />
        </label>
        <label className="flex flex-1 items-center gap-2">
          Rotação
          <input type="range" min={-180} max={180} value={el.rotation} onChange={(e) => onChange({ rotation: Number(e.target.value) })} className="flex-1 accent-amber" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-text-dim">
        Tamanho
        <input type="range" min={0.03} max={0.16} step={0.005} value={el.size_factor} onChange={(e) => onChange({ size_factor: Number(e.target.value) })} className="flex-1 accent-amber" />
      </label>

      <fieldset className="space-y-2 rounded-md border border-border p-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={el.scrim.enabled} onChange={(e) => onChange({ scrim: { ...el.scrim, enabled: e.target.checked } })} className="accent-amber" />
          Fundo
          {el.scrim.enabled && (
            <input type="color" value={el.scrim.color} onChange={(e) => onChange({ scrim: { ...el.scrim, color: e.target.value.toUpperCase() } })} className="ml-auto h-7 w-8 rounded border border-border bg-transparent" />
          )}
        </label>
        {el.scrim.enabled && (
          <label className="flex items-center gap-2 pl-6 text-xs text-text-dim">
            <input type="checkbox" checked={el.scrim.adaptive} onChange={(e) => onChange({ scrim: { ...el.scrim, adaptive: e.target.checked } })} className="accent-amber" />
            Adaptativo
            {!el.scrim.adaptive && (
              <input type="range" min={0} max={255} value={el.scrim.opacity} onChange={(e) => onChange({ scrim: { ...el.scrim, opacity: Number(e.target.value) } })} className="flex-1 accent-amber" />
            )}
          </label>
        )}
      </fieldset>

      <fieldset className="space-y-2 rounded-md border border-border p-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={el.outline.enabled} onChange={(e) => onChange({ outline: { ...el.outline, enabled: e.target.checked } })} className="accent-amber" />
          Contorno
          {el.outline.enabled && (
            <input type="color" value={el.outline.color} onChange={(e) => onChange({ outline: { ...el.outline, color: e.target.value.toUpperCase() } })} className="ml-auto h-7 w-8 rounded border border-border bg-transparent" />
          )}
        </label>
        {el.outline.enabled && (
          <label className="flex items-center gap-2 pl-6 text-xs text-text-dim">
            Espessura
            <input type="range" min={0} max={12} value={el.outline.width} onChange={(e) => onChange({ outline: { ...el.outline, width: Number(e.target.value) } })} className="flex-1 accent-amber" />
          </label>
        )}
      </fieldset>
    </div>
  );
}
