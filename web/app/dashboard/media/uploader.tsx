"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton } from "@/components/ui";
import { StoryEditor } from "@/components/story-editor";
import { newTextElement, type StoryDoc } from "@/lib/story-doc";

type Account = { id: string; label: string };

export function Uploader({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [doc, setDoc] = useState<StoryDoc>(() => ({ version: 1, elements: [newTextElement()] }));
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [when, setWhen] = useState("");
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<"preview" | "schedule" | "now" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"schedule" | "now" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null) {
    setDone(null);
    setRenderUrl(null);
    setFile(f);
    setBgUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  async function runPreview() {
    if (!file) return;
    setLoading("preview");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc", JSON.stringify(doc));
      const res = await fetch("/api/preview", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "falha");
      const blob = await res.blob();
      setRenderUrl((old) => {
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
      fd.append("doc", JSON.stringify(doc));
      if (immediate) fd.append("now", "1");
      // `when` vem do datetime-local (horário local). Converte pra ISO (UTC).
      else fd.append("scheduled_at", new Date(when).toISOString());
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
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md border border-dashed border-border bg-surface/40 px-4 py-2.5 text-sm text-text-dim transition-colors hover:border-amber hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <span aria-hidden="true" className="text-lg">＋</span>
          {file ? file.name : "Escolher foto"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <span className="text-xs text-text-faint">arraste os textos na foto pra posicionar</span>
      </div>

      <StoryEditor doc={doc} onChange={setDoc} bgSrc={bgUrl} />

      <div className="grid max-w-xl grid-cols-2 gap-3">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          aria-label="Conta"
          className="rounded-md border border-border bg-surface/60 px-3 py-2.5 text-sm text-text focus:border-amber focus:outline-none"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id} className="bg-bg-raised">{a.label}</option>
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

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runPreview}
          disabled={!file || loading !== null}
          className="rounded-md border border-border px-4 py-2 text-sm text-text-dim transition-colors hover:border-amber hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
        >
          {loading === "preview" ? "revelando…" : "Ver render real"}
        </button>
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={!file || loading !== null}
          className="rounded-md border border-amber px-4 py-2 text-sm font-medium text-amber transition-colors hover:bg-amber hover:text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
        >
          {loading === "now" ? "publicando…" : "Postar agora"}
        </button>
        <PrimaryButton onClick={() => submit(false)} disabled={!file || !when || loading !== null}>
          {loading === "schedule" ? "agendando…" : "Agendar"}
        </PrimaryButton>
      </div>

      <div aria-live="polite">
        {done === "now" && (
          <p className="text-sm text-green">Na fila ✓ — publica em instantes. Acompanhe em Agenda.</p>
        )}
        {done === "schedule" && <p className="text-sm text-green">Agendado ✓ — veja em Agenda.</p>}
        {error && <p className="text-sm text-red">{error}</p>}
      </div>

      {renderUrl && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-text-faint">Render real do server</p>
          <div className="aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-2xl border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={renderUrl} alt="Render do Story" className="h-full w-full object-cover" />
          </div>
        </div>
      )}
    </div>
  );
}
