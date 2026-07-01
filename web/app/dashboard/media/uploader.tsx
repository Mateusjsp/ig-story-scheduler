"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton } from "@/components/ui";

type Account = { id: string; label: string };

export function Uploader({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [when, setWhen] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<"preview" | "schedule" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function runPreview() {
    if (!file) return;
    setLoading("preview");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (caption.trim()) fd.append("caption", caption.trim());
      const res = await fetch("/api/preview", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "falha");
      const blob = await res.blob();
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setLoading(null);
    }
  }

  async function schedule() {
    if (!file || !accountId || !when) return;
    setLoading("schedule");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("account_id", accountId);
      fd.append("scheduled_at", when);
      if (caption.trim()) fd.append("caption", caption.trim());
      const res = await fetch("/api/media/create", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "falha");
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="grid grid-cols-[1fr_320px] gap-8">
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface/40 text-text-dim transition-colors hover:border-amber hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <span aria-hidden="true" className="text-2xl">＋</span>
          <span className="text-sm">{file ? file.name : "Escolher foto"}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setDone(false);
          }}
        />

        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          aria-label="Legenda"
          placeholder="Legenda (opcional) — desenhada na imagem"
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-surface/60 px-4 py-3 text-text placeholder:text-text-faint focus:border-amber focus:outline-none"
        />

        <div className="grid grid-cols-2 gap-3">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-label="Conta"
            className="rounded-md border border-border bg-surface/60 px-3 py-2.5 text-sm text-text focus:border-amber focus:outline-none"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id} className="bg-bg-raised">
                {a.label}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            aria-label="Agendar para"
            className="rounded-md border border-border bg-surface/60 px-3 py-2.5 text-sm focus:border-amber focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={runPreview}
            disabled={!file || loading !== null}
            className="rounded-md border border-border px-4 py-2 text-sm text-text-dim transition-colors hover:border-amber hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
          >
            {loading === "preview" ? "revelando…" : "Preview"}
          </button>
          <PrimaryButton
            onClick={schedule}
            disabled={!file || !when || loading !== null}
          >
            {loading === "schedule" ? "agendando…" : "Agendar"}
          </PrimaryButton>
        </div>

        <div aria-live="polite">
          {done && <p className="text-sm text-green">Agendado ✓ — veja em Agenda.</p>}
          {error && <p className="text-sm text-red">{error}</p>}
        </div>
      </div>

      <div className="sticky top-9">
        <div className="mx-auto aspect-[9/16] w-full overflow-hidden rounded-[1.75rem] border-2 border-border bg-bg-raised shadow-2xl">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Preview do Story"
              width={360}
              height={640}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-faint">
              o preview do Story aparece aqui
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
