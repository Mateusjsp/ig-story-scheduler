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
  const [loading, setLoading] = useState<"preview" | "schedule" | "now" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"schedule" | "now" | null>(null);
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

  async function submit(immediate: boolean) {
    if (!file || !accountId || (!immediate && !when)) return;
    setLoading(immediate ? "now" : "schedule");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("account_id", accountId);
      if (immediate) fd.append("now", "1");
      // `when` vem do datetime-local (horário local, sem fuso). Converte pra ISO
      // (UTC) aqui no browser pra o server comparar o instante certo.
      else fd.append("scheduled_at", new Date(when).toISOString());
      if (caption.trim()) fd.append("caption", caption.trim());
      const res = await fetch("/api/media/create", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "falha");
      setDone(immediate ? "now" : "schedule");
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
            setDone(null);
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
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={!file || loading !== null}
            className="rounded-md border border-amber px-4 py-2 text-sm font-medium text-amber transition-colors hover:bg-amber hover:text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
          >
            {loading === "now" ? "publicando…" : "Postar agora"}
          </button>
          <PrimaryButton
            onClick={() => submit(false)}
            disabled={!file || !when || loading !== null}
          >
            {loading === "schedule" ? "agendando…" : "Agendar"}
          </PrimaryButton>
        </div>

        <div aria-live="polite">
          {done === "now" && (
            <p className="text-sm text-green">
              Na fila ✓ — publica em instantes. Acompanhe em Agenda.
            </p>
          )}
          {done === "schedule" && (
            <p className="text-sm text-green">Agendado ✓ — veja em Agenda.</p>
          )}
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
