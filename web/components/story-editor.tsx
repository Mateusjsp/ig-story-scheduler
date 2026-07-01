"use client";

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  DEFAULT_PHOTO,
  FONT_CSS,
  newStickerElement,
  newTextElement,
  notoUrl,
  type Element,
  type Photo,
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
  | { kind: "resize"; id: string; cx: number; cy: number; dist: number; base: number; field: "size_factor" | "w" }
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// helpers de módulo (fora do render) — evita a regra de pureza do react-hooks.
const nowMs = () => Date.now();
let _dupSeq = 0;
const dupId = (type: string) => `${type}-dup-${(_dupSeq += 1)}`;

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
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const [editKey, setEditKey] = useState(0); // muda ao pedir edição de texto (duplo-clique)

  const selected = doc.elements.find((e) => e.id === selectedId) ?? null;
  const photo: Photo = doc.photo ?? DEFAULT_PHOTO;

  // Undo/redo com coalescência: mudanças a menos de 400ms (arrasto/slider) viram
  // um passo só. commit() é a via de toda mutação; snapshota o doc anterior.
  const history = useRef<{ past: StoryDoc[]; future: StoryDoc[] }>({ past: [], future: [] });
  const lastCommit = useRef(0);
  const [histLen, setHistLen] = useState({ u: 0, r: 0 }); // espelho pro render (undo/redo habilitados)

  function syncHist() {
    setHistLen({ u: history.current.past.length, r: history.current.future.length });
  }

  function commit(next: StoryDoc) {
    const now = nowMs();
    if (now - lastCommit.current > 400) {
      history.current.past.push(doc);
      if (history.current.past.length > 60) history.current.past.shift();
      history.current.future = [];
      syncHist();
    }
    lastCommit.current = now;
    onChange(next);
  }

  function undo() {
    const h = history.current;
    if (!h.past.length) return;
    h.future.push(doc);
    lastCommit.current = 0;
    syncHist();
    onChange(h.past.pop()!);
  }

  function redo() {
    const h = history.current;
    if (!h.future.length) return;
    h.past.push(doc);
    lastCommit.current = 0;
    syncHist();
    onChange(h.future.pop()!);
  }

  function setPhoto(patch: Partial<Photo>) {
    commit({ ...doc, photo: { ...photo, ...patch } });
  }

  // Formato da foto + escala pra preencher o frame 9:16 (a partir do aspecto).
  const frameAR = 9 / 16;
  const imgAR = natural ? natural.w / natural.h : null;
  const format =
    imgAR == null ? null : imgAR > 1.15 ? "Paisagem" : imgAR < 0.87 ? "Retrato" : "Quadrado";
  const fillScale = imgAR == null ? 1 : Math.max(frameAR / imgAR, imgAR / frameAR);

  function update(id: string, patch: Patch) {
    commit({
      ...doc,
      elements: doc.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as Element) : e)),
    });
  }

  function addText() {
    const el = newTextElement();
    commit({ ...doc, elements: [...doc.elements, el] });
    setSelectedId(el.id);
  }

  function addSticker(emoji: string) {
    const el = newStickerElement(emoji);
    commit({ ...doc, elements: [...doc.elements, el] });
    setSelectedId(el.id);
    setPickerOpen(false);
  }

  function duplicate(id: string) {
    const src = doc.elements.find((e) => e.id === id);
    if (!src) return;
    const el: Element = { ...src, id: dupId(src.type), x: clamp(src.x + 0.05, 0, 1), y: clamp(src.y + 0.05, 0, 1) };
    commit({ ...doc, elements: [...doc.elements, el] });
    setSelectedId(el.id);
  }

  function remove(id: string) {
    commit({ ...doc, elements: doc.elements.filter((e) => e.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }

  function reorder(id: string, dir: 1 | -1) {
    const i = doc.elements.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= doc.elements.length) return;
    const els = [...doc.elements];
    [els[i], els[j]] = [els[j], els[i]];
    commit({ ...doc, elements: els });
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
      let x = clamp(g.ox + (e.clientX - g.sx) / r.width, 0, 1);
      let y = clamp(g.oy + (e.clientY - g.sy) / r.height, 0, 1);
      // snap ao centro com guias (tipo Canva)
      const v = Math.abs(x - 0.5) < 0.015;
      const h = Math.abs(y - 0.5) < 0.015;
      if (v) x = 0.5;
      if (h) y = 0.5;
      setGuides((prev) => (prev.v === v && prev.h === h ? prev : { v, h }));
      update(g.id, { x, y });
    } else if (g.kind === "rotate") {
      const ang = Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * (180 / Math.PI);
      let rot = g.base + (ang - g.start);
      rot = ((rot + 180) % 360 + 360) % 360 - 180; // normaliza -180..180
      update(g.id, { rotation: Math.round(rot) });
    } else if (g.kind === "resize") {
      const d = Math.hypot(e.clientX - g.cx, e.clientY - g.cy);
      const val = clamp((g.base * d) / g.dist, 0.02, g.field === "w" ? 1 : 0.3);
      update(g.id, { [g.field]: val });
    } else if (g.kind === "pan") {
      setPhoto({
        offset_x: clamp(g.ox + (e.clientX - g.sx) / r.width, -1, 1),
        offset_y: clamp(g.oy + (e.clientY - g.sy) / r.height, -1, 1),
      });
    }
  }

  function onStagePointerDown(e: RPointerEvent) {
    setSelectedId(null);
    if (!bgSrc) return; // sem foto: nada pra arrastar
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: photo.offset_x, oy: photo.offset_y };
  }

  function onPointerUp() {
    gesture.current = null;
    if (guides.v || guides.h) setGuides({ v: false, h: false });
  }

  // Atalhos: Delete remove, setas movem (Shift = passo maior), Esc desmarca.
  // Ignora quando o foco está num campo (pra não atrapalhar digitação no painel).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      // Undo/redo (funciona sem seleção; não sequestra digitação em campos).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !inField) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !inField) {
        e.preventDefault();
        redo();
        return;
      }
      if (!selectedId) return;
      if (inField) return;
      const el = doc.elements.find((x) => x.id === selectedId);
      if (!el) return;
      const step = e.shiftKey ? 0.05 : 0.01;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove(selectedId);
      } else if (e.key === "Escape") {
        setSelectedId(null);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        update(selectedId, { x: clamp(el.x - step, 0, 1) });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        update(selectedId, { x: clamp(el.x + step, 0, 1) });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        update(selectedId, { y: clamp(el.y - step, 0, 1) });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        update(selectedId, { y: clamp(el.y + step, 0, 1) });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom da foto com a roda do mouse (listener não-passivo pra poder preventDefault).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!bgSrc) return;
      e.preventDefault();
      const next = clamp(photo.scale * (1 - e.deltaY * 0.0015), 1, 5);
      setPhoto({ scale: Number(next.toFixed(3)) });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [doc, bgSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* palco: foto grande, ocupa a altura da tela */}
      <div className="flex justify-center">
        <div
          ref={stageRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerDown={onStagePointerDown}
          style={{ containerType: "inline-size", cursor: bgSrc ? "grab" : "default" }}
          className="relative aspect-[9/16] h-[74vh] max-h-[820px] max-w-full touch-none select-none overflow-hidden rounded-[1.75rem] border-2 border-border bg-bg-raised shadow-2xl"
        >
          {/* fundo blur-fill aproximado (bate com o server: cover borrado + contain nítido) */}
          {bgSrc && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bgSrc} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bgSrc}
                alt="Foto"
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                style={{
                  transform: `translate(${photo.offset_x * 100}%, ${photo.offset_y * 100}%) scale(${photo.scale})`,
                  transformOrigin: "center",
                }}
              />
            </>
          )}
          {!bgSrc && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center text-text-faint">
              <span aria-hidden className="text-4xl">▦</span>
              <p className="text-sm">Escolha uma foto pra começar</p>
              <p className="text-xs">o Story aparece aqui em 9:16 com fundo desfocado</p>
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
                onEdit={() => {
                  setSelectedId(el.id);
                  setEditKey((k) => k + 1);
                }}
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

          {/* guias de centro (aparecem ao arrastar perto do meio) */}
          {guides.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-amber/80" />}
          {guides.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-amber/80" />}
        </div>
      </div>

      {/* coluna de controles: foto + ferramentas + propriedades + ajustes do post */}
      <div className="space-y-4">
        {bgSrc && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-text-faint">Foto</p>
              {format && <span className="text-xs text-text-dim">{format}</span>}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPhoto({ scale: 1, offset_x: 0, offset_y: 0 })} className={btnCls}>Ajustar</button>
              <button type="button" onClick={() => setPhoto({ scale: Number(fillScale.toFixed(3)), offset_x: 0, offset_y: 0 })} className={btnCls}>Preencher</button>
            </div>
            <label className="flex items-center gap-2 text-xs text-text-dim">
              Zoom
              <input
                type="range"
                min={1}
                max={5}
                step={0.01}
                value={photo.scale}
                onChange={(e) => setPhoto({ scale: Number(e.target.value) })}
                className="flex-1 accent-amber"
                aria-label="Zoom da foto"
              />
            </label>
            <p className="text-[0.7rem] text-text-faint">arraste a foto no palco pra reposicionar · roda do mouse dá zoom</p>
          </div>
        )}

        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-text-faint">
          Camadas
        </p>
        <div className="relative flex flex-wrap gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={histLen.u === 0}
            title="Desfazer (Ctrl+Z)"
            aria-label="Desfazer"
            className={`${btnCls} disabled:opacity-40`}
          >
            ↶
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={histLen.r === 0}
            title="Refazer (Ctrl+Shift+Z)"
            aria-label="Refazer"
            className={`${btnCls} disabled:opacity-40`}
          >
            ↷
          </button>
          <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
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
          <ElementPanel el={selected} onChange={(p) => update(selected.id, p)} focusSignal={editKey} />
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
  "rounded-full border border-border px-3 py-1.5 text-xs text-text-dim transition-colors hover:border-amber hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

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
  onEdit,
}: {
  el: TextElement;
  selected: boolean;
  onBody: (e: RPointerEvent) => void;
  onRotate: (e: RPointerEvent) => void;
  onResize: (e: RPointerEvent) => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const scrimBg =
    el.scrim.enabled
      ? hexA(el.scrim.color, el.scrim.adaptive ? 0.43 : el.scrim.opacity / 255)
      : "transparent";
  return (
    <div
      onPointerDown={onBody}
      onDoubleClick={onEdit}
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
        outline: selected ? "2px solid rgba(240,136,62,0.95)" : "none",
        outlineOffset: 2,
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
        outline: selected ? "2px solid rgba(240,136,62,0.95)" : "none",
        outlineOffset: 2,
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
        role="button"
        aria-label="Remover elemento"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onDelete();
        }}
        title="Remover"
        style={{ ...handleStyle(-14, "0%", "pointer"), background: "#e0492f", color: "#fff", borderColor: "#fff" }}
      >
        ×
      </span>
      <span role="button" aria-label="Girar" onPointerDown={onRotate} title="Girar" style={handleStyle(-30, "50%", "grab")}>⟳</span>
      <span role="button" aria-label="Redimensionar" onPointerDown={onResize} title="Redimensionar" style={handleStyle("100%", "100%", "nwse-resize")}>⤡</span>
    </>
  );
}

function handleStyle(top: number | string, left: string, cursor: string): React.CSSProperties {
  return {
    position: "absolute",
    top: typeof top === "number" ? `${top}px` : top,
    left,
    transform: "translate(-50%, -50%)",
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "9999px",
    background: "#f0883e",
    color: "#100d0b",
    fontSize: 15,
    lineHeight: 1,
    border: "2px solid #100d0b",
    boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
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
  focusSignal,
}: {
  el: TextElement;
  onChange: (p: Partial<TextElement>) => void;
  focusSignal: number;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Duplo-clique no texto (focusSignal muda) -> foca e seleciona pra editar já.
  useEffect(() => {
    if (focusSignal > 0) {
      textRef.current?.focus();
      textRef.current?.select();
    }
  }, [focusSignal]);
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface/30 p-4">
      <textarea
        ref={textRef}
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
