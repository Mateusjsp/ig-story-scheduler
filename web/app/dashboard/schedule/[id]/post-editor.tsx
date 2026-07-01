"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, Badge } from "@/components/ui";
import { BUILTIN_PRESETS, normalizeStyle, type StyleConfig } from "@/lib/presets";

type Post = {
  id: string;
  scheduled_at: string;
  status: string;
  account_id: string;
  error: string | null;
  caption: string;
  style: StyleConfig;
  processed_url: string | null;
  has_original: boolean;
};
type Account = { id: string; label: string };
type PresetOpt = { id: string; name: string; config: StyleConfig };

// ISO (UTC) -> valor do <input datetime-local> (horário local).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const KEEP = "__keep__";

export function PostEditor({ post, accounts }: { post: Post; accounts: Account[] }) {
  const router = useRouter();
  const [when, setWhen] = useState(toLocalInput(post.scheduled_at));
  const [accountId, setAccountId] = useState(post.account_id);
  const [caption, setCaption] = useState(post.caption);
  const [presetId, setPresetId] = useState(KEEP); // KEEP = não mexe no estilo
  const [userPresets, setUserPresets] = useState<PresetOpt[]>([]);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/presets")
      .then((r) => (r.ok ? r.json() : { presets: [] }))
      .then((d: { presets?: PresetOpt[] }) => {
        if (alive)
          setUserPresets(
            (d.presets ?? []).map((p) => ({ ...p, config: normalizeStyle(p.config) })),
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const isFailed = post.status === "failed";

  function resolvedStyle(): StyleConfig | undefined {
    if (presetId === KEEP) return undefined;
    return [...BUILTIN_PRESETS, ...userPresets].find((p) => p.id === presetId)?.config;
  }

  async function save() {
    setBusy("save");
    setError(null);
    setOk(false);
    try {
      const body: Record<string, unknown> = {};
      if (when !== toLocalInput(post.scheduled_at)) {
        body.scheduled_at = new Date(when).toISOString();
      }
      if (accountId !== post.account_id) body.account_id = accountId;
      if (caption !== post.caption) body.caption = caption;
      const style = resolvedStyle();
      if (style) body.style = style;
      if (isFailed) body.reenqueue = true;

      if (Object.keys(body).length === 0) {
        setError("nada mudou");
        return;
      }
      const res = await fetch(`/api/schedule/${post.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "falha");
      setOk(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!confirm("Cancelar este post? A imagem também será removida.")) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/schedule/${post.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "falha");
      router.push("/dashboard/schedule");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
      setBusy(null);
    }
  }

  const inputCls =
    "w-full rounded-md border border-border bg-surface/60 px-3 py-2.5 text-sm text-text focus:border-amber focus:outline-none";

  return (
    <div className="grid grid-cols-[1fr_320px] gap-8">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge status={post.status} />
          {isFailed && post.error && (
            <span className="text-sm text-red">{post.error}</span>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="cap" className="text-xs text-text-dim">Legenda</label>
          <textarea
            id="cap"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-surface/60 px-4 py-3 text-text placeholder:text-text-faint focus:border-amber focus:outline-none"
            placeholder="Legenda — desenhada na imagem"
          />
          {!post.has_original && (
            <p className="text-xs text-amber">
              Sem a foto original salva — mudar legenda/estilo não re-renderiza. Reenvie
              pela tela de Mídia se precisar trocar.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="preset" className="text-xs text-text-dim">Estilo do texto</label>
          <select
            id="preset"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className={inputCls}
          >
            <option value={KEEP} className="bg-bg-raised">Manter atual</option>
            <optgroup label="Embutidos" className="bg-bg-raised">
              {BUILTIN_PRESETS.map((p) => (
                <option key={p.id} value={p.id} className="bg-bg-raised">{p.name}</option>
              ))}
            </optgroup>
            {userPresets.length > 0 && (
              <optgroup label="Meus presets" className="bg-bg-raised">
                {userPresets.map((p) => (
                  <option key={p.id} value={p.id} className="bg-bg-raised">{p.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="acc" className="text-xs text-text-dim">Conta</label>
            <select
              id="acc"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={inputCls}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="bg-bg-raised">{a.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="dt" className="text-xs text-text-dim">
              {isFailed ? "Reagendar para (reenfileira)" : "Agendar para"}
            </label>
            <input
              id="dt"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <PrimaryButton onClick={save} disabled={busy !== null}>
            {busy === "save" ? "salvando…" : isFailed ? "Salvar e reenfileirar" : "Salvar"}
          </PrimaryButton>
          <button
            type="button"
            onClick={cancel}
            disabled={busy !== null}
            className="rounded-md border border-border px-4 py-2 text-sm text-text-dim transition-colors hover:border-red hover:text-red disabled:opacity-50"
          >
            {busy === "delete" ? "cancelando…" : "Cancelar post"}
          </button>
          {ok && <span className="text-sm text-green">Salvo ✓</span>}
          {error && <span className="text-sm text-red">{error}</span>}
        </div>
      </div>

      <div className="sticky top-9 space-y-2">
        <div className="mx-auto aspect-[9/16] w-full overflow-hidden rounded-[1.75rem] border-2 border-border bg-bg-raised shadow-2xl">
          {post.processed_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.processed_url} alt="Story" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-faint">
              sem preview
            </div>
          )}
        </div>
        <p className="text-center text-xs text-text-faint">
          imagem atual — salvar re-renderiza se mudar legenda/estilo
        </p>
      </div>
    </div>
  );
}
