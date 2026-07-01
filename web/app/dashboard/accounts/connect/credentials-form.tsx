"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";

export function CredentialsForm({
  initialAppId,
  hasSecret,
}: {
  initialAppId: string;
  hasSecret: boolean;
}) {
  const [appId, setAppId] = useState(initialAppId);
  const [appSecret, setAppSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/instagram/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, appSecret }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Falha ao salvar credenciais.");
      setLoading(false);
      return;
    }

    // Salvou: segue direto pro OAuth da Meta.
    window.location.href = "/api/instagram/start";
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="app-id"
            className="mb-1 block font-mono text-xs uppercase tracking-wider text-text-faint"
          >
            App ID
          </label>
          <input
            id="app-id"
            name="app_id"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            required
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="ex: 1234567890123456"
            className="w-full rounded-md border border-border bg-surface/60 px-4 py-3 text-text placeholder:text-text-faint transition-colors focus:border-amber focus:bg-surface focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="app-secret"
            className="mb-1 block font-mono text-xs uppercase tracking-wider text-text-faint"
          >
            App Secret
          </label>
          <input
            id="app-secret"
            name="app_secret"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required={!hasSecret}
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder={hasSecret ? "•••••• (deixe em branco para manter)" : "seu app secret"}
            className="w-full rounded-md border border-border bg-surface/60 px-4 py-3 text-text placeholder:text-text-faint transition-colors focus:border-amber focus:bg-surface focus:outline-none"
          />
        </div>

        <div aria-live="polite">
          {error && (
            <p className="rounded-md border border-red/40 bg-surface px-3 py-2 text-sm text-red">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-amber px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-amber-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
          >
            {loading ? "salvando…" : "Salvar e conectar →"}
          </button>
          <Link
            href="/dashboard/accounts"
            className="rounded-sm text-sm text-text-faint underline-offset-4 transition-colors hover:text-amber hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </Card>
  );
}
