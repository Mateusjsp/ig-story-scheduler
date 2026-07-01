"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (password !== confirm) {
      setMsg("As senhas não conferem.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMsg(error.message);
      setLoading(false);
    } else {
      setMsg("Senha redefinida! Redirecionando…");
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      {/* halo de safelight */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(240,136,62,0.22), transparent 70%)" }}
      />

      <div className="animate-rise relative w-full max-w-sm">
        <div className="mb-10 text-center">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.35em] text-amber">
            ● rec · darkroom
          </p>
          <h1 className="mt-3 font-display text-5xl font-light leading-none tracking-tight">
            Nova senha<span className="text-amber">.</span>
          </h1>
          <p className="mt-3 text-sm text-text-dim">
            Escolha uma nova senha para sua conta.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="password"
            aria-label="Nova senha"
            name="new-password"
            autoComplete="new-password"
            required
            minLength={6}
            placeholder="mínimo 6 caracteres…"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-surface/60 px-4 py-3 text-text placeholder:text-text-faint transition-colors focus:border-amber focus:bg-surface focus:outline-none"
          />
          <input
            type="password"
            aria-label="Confirmar nova senha"
            name="confirm-password"
            autoComplete="new-password"
            required
            minLength={6}
            placeholder="repita a senha…"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-md border border-border bg-surface/60 px-4 py-3 text-text placeholder:text-text-faint transition-colors focus:border-amber focus:bg-surface focus:outline-none"
          />

          <button
            type="submit"
            disabled={loading}
            className="group relative w-full overflow-hidden rounded-md bg-amber px-4 py-3 font-medium text-bg transition-colors hover:bg-amber-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
          >
            {loading ? "salvando…" : "Redefinir senha"}
          </button>

          <div aria-live="polite">
            {msg && (
              <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-dim">
                {msg}
              </p>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
