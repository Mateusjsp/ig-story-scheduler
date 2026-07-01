"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PrimaryButton } from "@/components/ui";
import {
  BUILTIN_PRESETS,
  DEFAULT_STYLE,
  FONT_LABELS,
  POSITION_LABELS,
  normalizeStyle,
  validateStyle,
  type FontKey,
  type Position,
  type StyleConfig,
} from "@/lib/presets";

type UserPreset = {
  id: string;
  name: string;
  config: StyleConfig;
  is_default: boolean;
};

const FONTS = Object.keys(FONT_LABELS) as FontKey[];
const POSITIONS = Object.keys(POSITION_LABELS) as Position[];

// Imagem de amostra (canvas) pro preview ao vivo — evita precisar de asset e de
// o usuário subir uma foto só pra testar o estilo.
function makeSampleBlob(): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 720;
  c.height = 960;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 720, 960);
  g.addColorStop(0, "#2b3a67");
  g.addColorStop(0.5, "#b98a3a");
  g.addColorStop(1, "#101418");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 720, 960);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  for (let i = 0; i < 8; i++) ctx.fillRect(0, i * 120, 720, 40);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.85));
}

export function PresetsManager() {
  const [presets, setPresets] = useState<UserPreset[]>([]);
  const [name, setName] = useState("Meu estilo");
  const [style, setStyle] = useState<StyleConfig>(DEFAULT_STYLE);
  const [isDefault, setIsDefault] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const sampleRef = useRef<Blob | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/presets");
    if (!r.ok) return;
    const d = await r.json();
    setPresets(
      (d.presets ?? []).map((p: UserPreset) => ({ ...p, config: normalizeStyle(p.config) })),
    );
  }, []);

  // Carga inicial. Inline (async) pra o setState ficar depois do await — o lint
  // (set-state-in-effect) rejeita chamar `load()` direto no corpo do efeito.
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch("/api/presets");
      if (!r.ok || !alive) return;
      const d = await r.json();
      if (alive)
        setPresets(
          (d.presets ?? []).map((p: UserPreset) => ({
            ...p,
            config: normalizeStyle(p.config),
          })),
        );
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Preview ao vivo: regenera (debounced) sempre que o estilo muda.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        setPreviewing(true);
        if (!sampleRef.current) sampleRef.current = await makeSampleBlob();
        const fd = new FormData();
        fd.append("file", sampleRef.current, "sample.jpg");
        fd.append("caption", "Seu texto aqui ✨");
        fd.append("style", JSON.stringify(style));
        const res = await fetch("/api/preview", { method: "POST", body: fd });
        if (!res.ok || !alive) return;
        const blob = await res.blob();
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
      } finally {
        if (alive) setPreviewing(false);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [style]);

  function set<K extends keyof StyleConfig>(key: K, value: StyleConfig[K]) {
    setStyle((s) => ({ ...s, [key]: value }));
  }

  function startNew() {
    setEditingId(null);
    setName("Meu estilo");
    setStyle(DEFAULT_STYLE);
    setIsDefault(false);
    setError(null);
  }

  function loadFrom(cfg: StyleConfig, presetName: string, id: string | null, def = false) {
    setEditingId(id);
    setName(id ? presetName : `${presetName} (cópia)`);
    setStyle(normalizeStyle(cfg));
    setIsDefault(def);
    setError(null);
  }

  async function save() {
    const invalid = validateStyle(style);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({ name, config: style, is_default: isDefault });
      const res = editingId
        ? await fetch(`/api/presets/${editingId}`, { method: "PUT", body })
        : await fetch("/api/presets", { method: "POST", body });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "falha");
      await load();
      const saved = await res.json();
      setEditingId(saved.preset?.id ?? editingId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao salvar");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/presets/${id}`, { method: "DELETE" });
      if (editingId === id) startNew();
      await load();
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "rounded-md border border-border bg-surface/60 px-3 py-2 text-sm text-text focus:border-amber focus:outline-none";

  return (
    <div className="grid grid-cols-[1fr_320px] gap-8">
      {/* editor */}
      <div className="space-y-5">
        {/* lista */}
        <div className="flex flex-wrap gap-2">
          {BUILTIN_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadFrom(p.config, p.name, null)}
              className="rounded-full border border-border px-3 py-1 text-xs text-text-dim transition-colors hover:border-amber hover:text-amber"
            >
              {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={startNew}
            className="rounded-full border border-amber/50 px-3 py-1 text-xs text-amber transition-colors hover:bg-amber hover:text-bg"
          >
            + novo
          </button>
        </div>

        {presets.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-text-faint">Meus presets</p>
            <ul className="space-y-1.5">
              {presets.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-md border border-border bg-surface/40 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {p.name}
                    {p.is_default && (
                      <span className="rounded-full border border-amber/40 px-2 text-[0.65rem] text-amber">
                        padrão
                      </span>
                    )}
                  </span>
                  <span className="flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => loadFrom(p.config, p.name, p.id, p.is_default)}
                      className="text-text-dim hover:text-amber"
                    >
                      editar
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      className="text-text-dim hover:text-red"
                    >
                      apagar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* formulário */}
        <div className="space-y-4 rounded-xl border border-border bg-surface/30 p-5">
          <div className="space-y-1.5">
            <label htmlFor="p-name" className="text-xs text-text-dim">
              Nome {editingId ? "(editando)" : "(novo)"}
            </label>
            <input
              id="p-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full ${inputCls}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="p-font" className="text-xs text-text-dim">Fonte</label>
              <select
                id="p-font"
                value={style.font}
                onChange={(e) => set("font", e.target.value as FontKey)}
                className={`w-full ${inputCls}`}
              >
                {FONTS.map((f) => (
                  <option key={f} value={f} className="bg-bg-raised">
                    {FONT_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="p-pos" className="text-xs text-text-dim">Posição</label>
              <select
                id="p-pos"
                value={style.position}
                onChange={(e) => set("position", e.target.value as Position)}
                className={`w-full ${inputCls}`}
              >
                {POSITIONS.map((p) => (
                  <option key={p} value={p} className="bg-bg-raised">
                    {POSITION_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-text-dim">
              Cor do texto
              <input
                type="color"
                value={style.text_color}
                onChange={(e) => set("text_color", e.target.value.toUpperCase())}
                className="h-8 w-10 rounded border border-border bg-transparent"
                aria-label="Cor do texto"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-text-dim">
              Tamanho {Math.round(style.size_factor * 1000) / 10}%
              <input
                type="range"
                min={0.03}
                max={0.12}
                step={0.005}
                value={style.size_factor}
                onChange={(e) => set("size_factor", Number(e.target.value))}
                className="flex-1 accent-amber"
                aria-label="Tamanho do texto"
              />
            </label>
          </div>

          {/* scrim */}
          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={style.scrim.enabled}
                onChange={(e) => set("scrim", { ...style.scrim, enabled: e.target.checked })}
                className="accent-amber"
              />
              Fundo (scrim)
            </label>
            {style.scrim.enabled && (
              <div className="flex flex-wrap items-center gap-4 pl-6 text-sm text-text-dim">
                <label className="flex items-center gap-2">
                  Cor
                  <input
                    type="color"
                    value={style.scrim.color}
                    onChange={(e) => set("scrim", { ...style.scrim, color: e.target.value.toUpperCase() })}
                    className="h-7 w-9 rounded border border-border bg-transparent"
                    aria-label="Cor do fundo"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={style.scrim.adaptive}
                    onChange={(e) => set("scrim", { ...style.scrim, adaptive: e.target.checked })}
                    className="accent-amber"
                  />
                  Adaptativo
                </label>
                {!style.scrim.adaptive && (
                  <label className="flex flex-1 items-center gap-2">
                    Opacidade
                    <input
                      type="range"
                      min={0}
                      max={255}
                      value={style.scrim.opacity}
                      onChange={(e) => set("scrim", { ...style.scrim, opacity: Number(e.target.value) })}
                      className="flex-1 accent-amber"
                      aria-label="Opacidade do fundo"
                    />
                  </label>
                )}
              </div>
            )}
          </fieldset>

          {/* outline */}
          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={style.outline.enabled}
                onChange={(e) => set("outline", { ...style.outline, enabled: e.target.checked })}
                className="accent-amber"
              />
              Contorno no texto
            </label>
            {style.outline.enabled && (
              <div className="flex flex-wrap items-center gap-4 pl-6 text-sm text-text-dim">
                <label className="flex items-center gap-2">
                  Cor
                  <input
                    type="color"
                    value={style.outline.color}
                    onChange={(e) => set("outline", { ...style.outline, color: e.target.value.toUpperCase() })}
                    className="h-7 w-9 rounded border border-border bg-transparent"
                    aria-label="Cor do contorno"
                  />
                </label>
                <label className="flex flex-1 items-center gap-2">
                  Espessura {style.outline.width}
                  <input
                    type="range"
                    min={0}
                    max={12}
                    value={style.outline.width}
                    onChange={(e) => set("outline", { ...style.outline, width: Number(e.target.value) })}
                    className="flex-1 accent-amber"
                    aria-label="Espessura do contorno"
                  />
                </label>
              </div>
            )}
          </fieldset>

          <label className="flex items-center gap-2 text-sm text-text-dim">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="accent-amber"
            />
            Usar como padrão ao enviar
          </label>

          <div className="flex items-center gap-3">
            <PrimaryButton onClick={save} disabled={busy}>
              {busy ? "salvando…" : editingId ? "Salvar alterações" : "Criar preset"}
            </PrimaryButton>
            {editingId && (
              <button
                type="button"
                onClick={startNew}
                className="text-sm text-text-dim hover:text-amber"
              >
                cancelar
              </button>
            )}
            {error && <p className="text-sm text-red">{error}</p>}
          </div>
        </div>
      </div>

      {/* preview */}
      <div className="sticky top-9 space-y-2">
        <div className="mx-auto aspect-[9/16] w-full overflow-hidden rounded-[1.75rem] border-2 border-border bg-bg-raised shadow-2xl">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Preview do estilo" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-faint">
              gerando preview…
            </div>
          )}
        </div>
        <p className="text-center text-xs text-text-faint">
          {previewing ? "atualizando…" : "amostra — o texto real vem da legenda"}
        </p>
      </div>
    </div>
  );
}
