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
import { MAX_USER_TAGS, newUserTag, type UserTag } from "@/lib/mentions";
import { EmojiPicker } from "@/components/emoji-picker";

// Editor de Story em camadas: fundo (blur-fill aproximado por CSS) + textos e
// emojis arrastáveis/redimensionáveis/rotacionáveis, ao vivo com os mesmos assets
// do render. Controlado: recebe `doc` e emite `onChange`. Server re-renderiza no save.
//
// UX de digitação mira o Instagram mobile: toca a foto -> cria e edita o texto
// inline no palco (contentEditable centralizado), toolbar flutuante no topo,
// slider vertical de tamanho na borda, paleta rápida de cores no rodapé. O painel
// lateral vira fallback/desktop (ajuste fino), escondido nas larguras de celular.

// patch frouxo: campos de texto ou sticker (merge por id; type nunca é alterado).
type Patch = Record<string, unknown>;

type Gesture =
  | { kind: "move"; id: string; ox: number; oy: number; sx: number; sy: number; wasSelected: boolean; moved: boolean }
  | { kind: "rotate"; id: string; cx: number; cy: number; start: number; base: number }
  | { kind: "resize"; id: string; cx: number; cy: number; dist: number; base: number; field: "size_factor" | "w" }
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// helpers de módulo (fora do render) — evita a regra de pureza do react-hooks.
const nowMs = () => Date.now();
let _dupSeq = 0;
const dupId = (type: string) => `${type}-dup-${(_dupSeq += 1)}`;

// Paleta rápida (tipo IG). Custom fica no <input type=color> ao lado.
const SWATCHES = [
  "#FFFFFF", "#000000", "#F0883E", "#FFD400", "#E0492F",
  "#3897F0", "#22C55E", "#EC4899", "#8B5CF6", "#14B8A6",
];

export function StoryEditor({
  doc,
  onChange,
  bgSrc,
  footer,
  aspectW = 9,
  aspectH = 16,
  mentions = [],
  onMentionsChange,
}: {
  doc: StoryDoc;
  onChange: (d: StoryDoc) => void;
  bgSrc: string | null;
  footer?: React.ReactNode;
  // Proporção do frame (story 9:16, feed 4:5 ou 1:1). Coords do doc são
  // normalizadas, então só a moldura muda — posições dos elementos não.
  aspectW?: number;
  aspectH?: number;
  // Marcações de pessoas (@) — metadata de publicação, não vai pro render. Quando
  // onMentionsChange é passado, o editor mostra os pins arrastáveis + botão "@ Marcar".
  mentions?: UserTag[];
  onMentionsChange?: (m: UserTag[]) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // texto em edição inline
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState<string | null>(null); // null = fechado; string = input aberto
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });

  const selected = doc.elements.find((e) => e.id === selectedId) ?? null;
  const selectedText = selected?.type === "text" ? selected : null;
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

  // Formato da foto + escala pra preencher o frame (a partir do aspecto do alvo).
  const frameAR = aspectW / aspectH;
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
    // Nasce vazio e já em edição — toca e digita, como no IG.
    const el = newTextElement({ text: "" });
    commit({ ...doc, elements: [...doc.elements, el] });
    setSelectedId(el.id);
    setEditingId(el.id);
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
    if (editingId === id) setEditingId(null);
  }

  // Fim da edição inline: texto vazio (só espaços) = descarta o elemento (IG faz igual).
  function endEdit() {
    const id = editingId;
    setEditingId(null);
    if (!id) return;
    const el = doc.elements.find((e) => e.id === id);
    if (el?.type === "text" && !el.text.trim()) remove(id);
  }

  // ── marcações de pessoas (@) ──
  function commitTag() {
    const draft = tagDraft ?? "";
    setTagDraft(null);
    if (!onMentionsChange || !draft.trim()) return;
    if (mentions.length >= MAX_USER_TAGS) return;
    const t = newUserTag(draft, 0.5, 0.5);
    if (!t || mentions.some((m) => m.username === t.username)) return; // inválido ou repetido
    onMentionsChange([...mentions, t]);
  }

  function moveMention(i: number, x: number, y: number) {
    onMentionsChange?.(mentions.map((m, j) => (j === i ? { ...m, x, y } : m)));
  }

  function removeMention(i: number) {
    onMentionsChange?.(mentions.filter((_, j) => j !== i));
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
    if (editingId === el.id) return; // digitando: deixa o caret trabalhar
    e.stopPropagation();
    const wasSelected = selectedId === el.id;
    setSelectedId(el.id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind: "move", id: el.id, ox: el.x, oy: el.y, sx: e.clientX, sy: e.clientY, wasSelected, moved: false };
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
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 4) g.moved = true;
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
    if (editingId) endEdit();
    if (!bgSrc) return; // sem foto: nada pra arrastar
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: photo.offset_x, oy: photo.offset_y };
  }

  function onPointerUp() {
    const g = gesture.current;
    gesture.current = null;
    if (guides.v || guides.h) setGuides({ v: false, h: false });
    // Toque (sem arrasto) num texto já selecionado -> entra em edição inline (IG).
    if (g && g.kind === "move" && !g.moved && g.wasSelected) {
      const el = doc.elements.find((x) => x.id === g.id);
      if (el?.type === "text") setEditingId(g.id);
    }
  }

  // Atalhos: Delete remove, setas movem (Shift = passo maior), Esc desmarca.
  // Ignora quando o foco está num campo OU num texto em edição inline (contentEditable),
  // pra não sequestrar a digitação.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const inField =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!t?.isContentEditable;
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
          style={{
            containerType: "inline-size",
            cursor: bgSrc ? "grab" : "default",
            aspectRatio: `${aspectW} / ${aspectH}`,
          }}
          className="relative h-[74vh] max-h-[820px] max-w-full touch-none select-none overflow-hidden rounded-[1.75rem] border-2 border-border bg-bg-raised shadow-2xl"
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
              <p className="text-xs">
                a prévia aparece aqui em {aspectW}:{aspectH} com fundo desfocado
              </p>
            </div>
          )}

          {doc.elements.map((el) =>
            el.type === "text" ? (
              <TextLayer
                key={el.id}
                el={el}
                selected={el.id === selectedId}
                editing={el.id === editingId}
                onBody={(e) => onPointerDownBody(e, el)}
                onRotate={(e) => onPointerDownRotate(e, el)}
                onResize={(e) => onPointerDownResize(e, el)}
                onDelete={() => remove(el.id)}
                onEdit={() => {
                  setSelectedId(el.id);
                  setEditingId(el.id);
                }}
                onTextInput={(text) => update(el.id, { text })}
                onEndEdit={endEdit}
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

          {/* pins de marcação (@) — arrastáveis; só no modo editor (onMentionsChange) */}
          {onMentionsChange &&
            mentions.map((m, i) => (
              <MentionPin
                key={m.username}
                tag={m}
                stageRef={stageRef}
                onMove={(x, y) => moveMention(i, x, y)}
                onRemove={() => removeMention(i)}
              />
            ))}

          {/* guias de centro (aparecem ao arrastar perto do meio) */}
          {guides.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-amber/80" />}
          {guides.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-amber/80" />}

          {/* ── overlays flutuantes tipo IG: só quando um texto está ativo ── */}
          {selectedText && (
            <>
              <TextToolbar
                el={selectedText}
                editing={editingId === selectedText.id}
                onChange={(p) => update(selectedText.id, p)}
                onDone={endEdit}
              />
              <SizeSlider
                value={selectedText.size_factor}
                onChange={(v) => update(selectedText.id, { size_factor: v })}
              />
              <ColorRow el={selectedText} onChange={(p) => update(selectedText.id, p)} />
            </>
          )}
        </div>
      </div>

      {/* coluna de controles (desktop): foto + ferramentas + propriedades + ajustes do
          post. Escondida no celular — lá o fluxo é 100% pelos overlays do palco. */}
      <div className="space-y-4">
        {bgSrc && (
          <div className="hidden space-y-2 lg:block">
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
          {onMentionsChange &&
            (tagDraft === null ? (
              <button
                type="button"
                onClick={() => setTagDraft("")}
                disabled={mentions.length >= MAX_USER_TAGS}
                className={`${btnCls} disabled:opacity-40`}
                title="Marcar pessoa (@)"
              >
                @ Marcar
              </button>
            ) : (
              <input
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onBlur={commitTag}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTag();
                  } else if (e.key === "Escape") {
                    setTagDraft(null);
                  }
                }}
                placeholder="@usuário"
                aria-label="Usuário pra marcar"
                className="w-32 rounded-full border border-amber bg-surface/60 px-3 py-1.5 text-xs text-text focus:outline-none"
              />
            ))}
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

        {/* Ajuste fino (desktop): controles detalhados. No celular fica escondido. */}
        <div className="hidden lg:block">
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
        </div>

        {footer && <div className="space-y-4 border-t border-border pt-4">{footer}</div>}
      </div>
    </div>
  );
}

const btnCls =
  "rounded-full border border-border px-3 py-1.5 text-xs text-text-dim transition-colors hover:border-amber hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

function textShadow(el: TextElement): string | undefined {
  const parts: string[] = [];
  if (el.outline.enabled && el.outline.width > 0) {
    const w = el.outline.width;
    const c = el.outline.color;
    // aproxima o stroke do Pillow com múltiplas sombras
    parts.push(
      `${w}px 0 ${c}`, `-${w}px 0 ${c}`, `0 ${w}px ${c}`, `0 -${w}px ${c}`,
      `${w}px ${w}px ${c}`, `-${w}px -${w}px ${c}`, `${w}px -${w}px ${c}`, `-${w}px ${w}px ${c}`,
    );
  }
  if (el.glow.enabled && el.glow.radius > 0) {
    // Glow em `em` -> escala com a fonte, batendo com o Pillow (blur = size*radius/100).
    // Camadas empilhadas dão a intensidade do neon.
    const c = el.glow.color;
    const r = el.glow.radius / 100;
    parts.push(`0 0 ${r}em ${c}`, `0 0 ${(r * 2).toFixed(3)}em ${c}`, `0 0 ${(r * 3).toFixed(3)}em ${c}`);
  }
  return parts.length ? parts.join(", ") : undefined;
}

// Estilo tipográfico partilhado pelo texto estático e pelo contentEditable — mantém
// o WYSIWYG idêntico ao entrar/sair da edição.
function textTypography(el: TextElement): React.CSSProperties {
  return {
    fontFamily: `"${FONT_CSS[el.font]}", sans-serif`,
    fontSize: `calc(${el.size_factor} * 100cqw)`,
    lineHeight: 1.15,
    color: el.color,
    textAlign: el.align,
    textShadow: textShadow(el),
  };
}

function TextLayer({
  el,
  selected,
  editing,
  onBody,
  onRotate,
  onResize,
  onDelete,
  onEdit,
  onTextInput,
  onEndEdit,
}: {
  el: TextElement;
  selected: boolean;
  editing: boolean;
  onBody: (e: RPointerEvent) => void;
  onRotate: (e: RPointerEvent) => void;
  onResize: (e: RPointerEvent) => void;
  onDelete: () => void;
  onEdit: () => void;
  onTextInput: (text: string) => void;
  onEndEdit: () => void;
}) {
  // Highlight (por linha) tem prioridade sobre o scrim (caixa do bloco). Quando
  // ligado, o fundo vai no <span> interno (uma pílula por linha); o scrim fica off.
  const useHighlight = el.highlight.enabled;
  const scrimBg =
    el.scrim.enabled && !useHighlight
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
        ...textTypography(el),
        background: scrimBg,
        borderRadius: "0.4em",
        padding: "0.3em 0.5em",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        cursor: editing ? "text" : "move",
        outline: selected ? "2px solid rgba(240,136,62,0.95)" : "none",
        outlineOffset: 2,
      }}
    >
      {editing ? (
        <EditableText initial={el.text} align={el.align} onInput={onTextInput} onEnd={onEndEdit} />
      ) : useHighlight ? (
        // box-decoration-break: clone -> cada linha quebrada ganha sua própria pílula,
        // igual ao render por-linha do Pillow (_render_text_element).
        <span
          style={{
            background: hexA(el.highlight.color, el.highlight.opacity / 255),
            padding: "0.1em 0.16em",
            borderRadius: "0.22em",
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {el.text || " "}
        </span>
      ) : (
        el.text || " "
      )}
      {selected && !editing && <Handles onRotate={onRotate} onResize={onResize} onDelete={onDelete} />}
    </div>
  );
}

// contentEditable não-controlado: injeta o texto inicial e o caret no fim uma vez ao
// montar, depois só *lê* no onInput (nunca reescreve o DOM) — evita o caret pular.
function EditableText({
  initial,
  align,
  onInput,
  onEnd,
}: {
  initial: string;
  align: TextElement["align"];
  onInput: (text: string) => void;
  onEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.textContent = initial;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false); // caret no fim
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- injeta só no mount da edição
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Editar texto"
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => onInput((e.currentTarget as HTMLDivElement).innerText)}
      onBlur={onEnd}
      onKeyDown={(e) => {
        // Esc encerra; Enter cria linha (whiteSpace pre-wrap já cuida da quebra).
        if (e.key === "Escape") {
          e.preventDefault();
          onEnd();
        }
        e.stopPropagation();
      }}
      style={{
        outline: "none",
        minWidth: "1ch",
        minHeight: "1em",
        textAlign: align,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        caretColor: "currentColor",
      }}
    />
  );
}

// Toolbar flutuante no topo do palco (tipo IG): fonte, alinhamento, fundo, + Concluir.
function TextToolbar({
  el,
  editing,
  onChange,
  onDone,
}: {
  el: TextElement;
  editing: boolean;
  onChange: (p: Partial<TextElement>) => void;
  onDone: () => void;
}) {
  const nextFont = () => {
    const i = FONTS.indexOf(el.font);
    onChange({ font: FONTS[(i + 1) % FONTS.length] });
  };
  const cycleAlign = () => {
    const order: TextElement["align"][] = ["left", "center", "right"];
    const i = order.indexOf(el.align);
    onChange({ align: order[(i + 1) % order.length] });
  };
  const alignIcon = el.align === "left" ? "⇤" : el.align === "right" ? "⇥" : "≡";
  // Fundo cicla: nenhum -> scrim (caixa do bloco) -> highlight (pílula por linha).
  const bgMode = el.highlight.enabled ? "highlight" : el.scrim.enabled ? "scrim" : "none";
  const cycleBg = () => {
    if (bgMode === "none") {
      onChange({ scrim: { ...el.scrim, enabled: true }, highlight: { ...el.highlight, enabled: false } });
    } else if (bgMode === "scrim") {
      // Vira marca-texto: a pílula herda a cor atual do texto e o texto vira tinta
      // legível sobre ela (evita branco-no-branco), como no IG.
      onChange({
        scrim: { ...el.scrim, enabled: false },
        highlight: { ...el.highlight, enabled: true, color: el.color },
        color: readableInk(el.color),
      });
    } else {
      onChange({ scrim: { ...el.scrim, enabled: false }, highlight: { ...el.highlight, enabled: false } });
    }
  };
  const bgLabel = bgMode === "highlight" ? "Marca-texto" : bgMode === "scrim" ? "Caixa" : "Fundo";
  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/55 px-1.5 py-1 backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" onClick={nextFont} className={pillCls} title="Trocar fonte">
        {FONT_LABELS[el.font]}
      </button>
      <button type="button" onClick={cycleAlign} className={pillCls} title="Alinhamento" aria-label="Alinhamento">
        {alignIcon}
      </button>
      <button
        type="button"
        onClick={cycleBg}
        className={`${pillCls} ${bgMode !== "none" ? "ring-1 ring-amber" : ""}`}
        title="Fundo do texto (nenhum · caixa · marca-texto)"
        aria-pressed={bgMode !== "none"}
      >
        {bgLabel}
      </button>
      <button
        type="button"
        onClick={() =>
          onChange({
            glow: el.glow.enabled
              ? { ...el.glow, enabled: false }
              : { ...el.glow, enabled: true, color: el.color }, // neon herda a cor do texto
          })
        }
        className={`${pillCls} ${el.glow.enabled ? "ring-1 ring-amber" : ""}`}
        title="Brilho neon"
        aria-pressed={el.glow.enabled}
      >
        Neon
      </button>
      {editing && (
        <button type="button" onClick={onDone} className={`${pillCls} bg-amber !text-bg`} title="Concluir">
          Concluir
        </button>
      )}
    </div>
  );
}

const pillCls =
  "rounded-full px-2.5 py-1 text-xs text-white/90 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber";

// Slider vertical de tamanho na borda esquerda (tipo IG). Rotacionado -90°.
function SizeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div
      className="pointer-events-auto absolute left-1 top-1/2 z-30 -translate-y-1/2"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="range"
        min={0.03}
        max={0.16}
        step={0.005}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Tamanho do texto"
        className="h-1.5 w-32 origin-center -rotate-90 cursor-pointer accent-amber"
      />
    </div>
  );
}

// Paleta rápida de cores no rodapé do palco + custom (spectrum) no fim. Com
// marca-texto ligado, a paleta pinta a PÍLULA e auto-contrasta o texto; senão,
// pinta o texto direto.
function ColorRow({ el, onChange }: { el: TextElement; onChange: (p: Partial<TextElement>) => void }) {
  const hl = el.highlight.enabled;
  const activeColor = (hl ? el.highlight.color : el.color).toUpperCase();
  const pick = (c: string) =>
    hl
      ? onChange({ highlight: { ...el.highlight, color: c }, color: readableInk(c) })
      : onChange({ color: c });
  return (
    <div
      className="pointer-events-auto absolute inset-x-0 bottom-2 z-30 flex items-center justify-center gap-1.5 px-3"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-white/15 bg-black/55 px-2 py-1.5 backdrop-blur">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => pick(c)}
            aria-label={`Cor ${c}`}
            className={`h-6 w-6 shrink-0 rounded-full border transition-transform hover:scale-110 ${
              activeColor === c ? "border-amber ring-2 ring-amber" : "border-white/40"
            }`}
            style={{ background: c }}
          />
        ))}
        <label className="relative h-6 w-6 shrink-0 cursor-pointer rounded-full border border-white/40" title="Cor personalizada"
          style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
          <input
            type="color"
            value={activeColor}
            onChange={(e) => pick(e.target.value.toUpperCase())}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Cor personalizada"
          />
        </label>
      </div>
    </div>
  );
}

// Pin de marcação (@) — arrastável, com seu próprio drag (isolado do gesture ref
// principal). Coordena em fração 0..1 sobre o palco. Visual de "etiqueta" branca
// pra deixar claro que é metadata, não texto renderizado.
function MentionPin({
  tag,
  stageRef,
  onMove,
  onRemove,
}: {
  tag: UserTag;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onMove: (x: number, y: number) => void;
  onRemove: () => void;
}) {
  const dragging = useRef(false);
  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        dragging.current = true;
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const r = stageRef.current?.getBoundingClientRect();
        if (!r) return;
        onMove(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      style={{
        position: "absolute",
        left: `${tag.x * 100}%`,
        top: `${tag.y * 100}%`,
        transform: "translate(-50%, -50%)",
        touchAction: "none",
      }}
      className="z-20 flex cursor-move items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-medium text-black shadow-md"
    >
      <span aria-hidden>@</span>
      {tag.username}
      <span
        role="button"
        aria-label={`Remover @${tag.username}`}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onRemove();
        }}
        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/15 text-[0.7rem] leading-none hover:bg-black/30"
      >
        ×
      </span>
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

// Tinta legível sobre uma cor de fundo (marca-texto): preto em fundo claro, branco
// em fundo escuro. Luminância relativa aproximada (BT.601).
function readableInk(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#000000" : "#FFFFFF";
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
          <input type="checkbox" checked={el.highlight.enabled} onChange={(e) => onChange({ highlight: { ...el.highlight, enabled: e.target.checked } })} className="accent-amber" />
          Marca-texto (por linha)
          {el.highlight.enabled && (
            <input type="color" value={el.highlight.color} onChange={(e) => onChange({ highlight: { ...el.highlight, color: e.target.value.toUpperCase() } })} className="ml-auto h-7 w-8 rounded border border-border bg-transparent" />
          )}
        </label>
        {el.highlight.enabled && (
          <label className="flex items-center gap-2 pl-6 text-xs text-text-dim">
            Opacidade
            <input type="range" min={0} max={255} value={el.highlight.opacity} onChange={(e) => onChange({ highlight: { ...el.highlight, opacity: Number(e.target.value) } })} className="flex-1 accent-amber" />
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

      <fieldset className="space-y-2 rounded-md border border-border p-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={el.glow.enabled} onChange={(e) => onChange({ glow: { ...el.glow, enabled: e.target.checked } })} className="accent-amber" />
          Neon (brilho)
          {el.glow.enabled && (
            <input type="color" value={el.glow.color} onChange={(e) => onChange({ glow: { ...el.glow, color: e.target.value.toUpperCase() } })} className="ml-auto h-7 w-8 rounded border border-border bg-transparent" />
          )}
        </label>
        {el.glow.enabled && (
          <label className="flex items-center gap-2 pl-6 text-xs text-text-dim">
            Intensidade
            <input type="range" min={0} max={40} value={el.glow.radius} onChange={(e) => onChange({ glow: { ...el.glow, radius: Number(e.target.value) } })} className="flex-1 accent-amber" />
          </label>
        )}
      </fieldset>
    </div>
  );
}
