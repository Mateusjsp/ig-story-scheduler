"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, Badge } from "@/components/ui";
import { StoryEditor } from "@/components/story-editor";
import { type StoryDoc } from "@/lib/story-doc";

type Post = {
  id: string;
  scheduled_at: string;
  status: string;
  account_id: string;
  error: string | null;
  doc: StoryDoc;
  bg_url: string | null;
  has_original: boolean;
};
type Account = { id: string; label: string };

// ISO (UTC) -> valor do <input datetime-local> (horário local).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function PostEditor({ post, accounts }: { post: Post; accounts: Account[] }) {
  const router = useRouter();
  const [doc, setDoc] = useState<StoryDoc>(post.doc);
  const [when, setWhen] = useState(toLocalInput(post.scheduled_at));
  const [accountId, setAccountId] = useState(post.account_id);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const isFailed = post.status === "failed";

  async function save() {
    setBusy("save");
    setError(null);
    setOk(false);
    try {
      const body: Record<string, unknown> = {};
      if (when !== toLocalInput(post.scheduled_at)) body.scheduled_at = new Date(when).toISOString();
      if (accountId !== post.account_id) body.account_id = accountId;
      if (JSON.stringify(doc) !== JSON.stringify(post.doc)) body.doc = doc;
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
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge status={post.status} />
        {isFailed && post.error && <span className="text-sm text-red">{post.error}</span>}
      </div>

      {!post.has_original && (
        <p className="text-xs text-amber">
          Sem a foto original salva — editar texto não re-renderiza. Reenvie pela tela de
          Mídia se precisar mudar.
        </p>
      )}

      <StoryEditor
        doc={doc}
        onChange={setDoc}
        bgSrc={post.bg_url}
        footer={
          <>
            <div className="grid grid-cols-2 gap-3">
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Conta" className={inputCls}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id} className="bg-bg-raised">{a.label}</option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                aria-label={isFailed ? "Reagendar para" : "Agendar para"}
                className={inputCls}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <PrimaryButton onClick={save} disabled={busy !== null}>
                {busy === "save" ? "salvando…" : isFailed ? "Salvar e reenfileirar" : "Salvar"}
              </PrimaryButton>
              <button
                type="button"
                onClick={cancel}
                disabled={busy !== null}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-dim transition-colors hover:border-red hover:text-red disabled:opacity-50"
              >
                {busy === "delete" ? "cancelando…" : "Cancelar post"}
              </button>
              {ok && <span className="text-sm text-green">Salvo ✓</span>}
              {error && <span className="text-sm text-red">{error}</span>}
            </div>
          </>
        }
      />
    </div>
  );
}
