"use client";

import { useMemo, useState } from "react";
import { EMOJI_CATEGORIES, searchEmoji, type EmojiItem } from "@/lib/emoji-data";
import { notoUrl } from "@/lib/story-doc";

// Seletor de emoji estilo teclado: abas de categoria + busca + grade.
// Renderiza os emojis via Noto PNG (mesmo asset do render server → bate).
export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [cat, setCat] = useState(EMOJI_CATEGORIES[0].id);
  const [q, setQ] = useState("");

  const items: EmojiItem[] = useMemo(() => {
    if (q.trim()) return searchEmoji(q);
    return EMOJI_CATEGORIES.find((c) => c.id === cat)?.items ?? [];
  }, [cat, q]);

  return (
    <div className="w-[280px] rounded-xl border border-border bg-bg-raised p-3 shadow-2xl">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar emoji…"
          className="flex-1 rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-sm text-text focus:border-amber focus:outline-none"
          autoFocus
        />
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-text-dim hover:text-amber"
          aria-label="Fechar"
        >
          ✕
        </button>
      </div>

      {!q.trim() && (
        <div className="mb-2 flex gap-1">
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCat(c.id)}
              title={c.label}
              className={`rounded-md px-1.5 py-1 text-lg transition-colors ${
                cat === c.id ? "bg-amber/20" : "hover:bg-surface/60"
              }`}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}

      <div className="grid max-h-[220px] grid-cols-6 gap-1 overflow-y-auto">
        {items.map(([emoji]) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            className="flex aspect-square items-center justify-center rounded-md hover:bg-surface/70"
            title={emoji}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={notoUrl(emoji)} alt={emoji} className="h-7 w-7" loading="lazy" />
          </button>
        ))}
        {items.length === 0 && (
          <p className="col-span-6 py-6 text-center text-xs text-text-faint">
            nada encontrado
          </p>
        )}
      </div>
    </div>
  );
}
