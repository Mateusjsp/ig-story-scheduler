"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const supabase = createClient();

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      setMsg(error ? error.message : "Conta criada. Confirme o e-mail se exigido, depois entre.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
      else {
        router.push("/dashboard");
        router.refresh();
      }
    }
    setLoading(false);
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
            {mode === "signin" ? "Revele" : "Comece"}
            <span className="text-amber">.</span>
          </h1>
          <p className="mt-3 text-sm text-text-dim">
            Sua fila de Stories, publicada sozinha.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <Field
            type="email"
            placeholder="e-mail"
            value={email}
            onChange={setEmail}
          />
          <Field
            type="password"
            placeholder="senha"
            value={password}
            onChange={setPassword}
            minLength={6}
          />

          <button
            type="submit"
            disabled={loading}
            className="group relative w-full overflow-hidden rounded-md bg-amber px-4 py-3 font-medium text-bg transition-all hover:bg-amber-bright disabled:opacity-50"
          >
            {loading ? "revelando…" : mode === "signin" ? "Entrar" : "Criar conta"}
          </button>

          {msg && (
            <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-dim">
              {msg}
            </p>
          )}
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-6 w-full text-center text-sm text-text-faint underline-offset-4 transition-colors hover:text-amber hover:underline"
        >
          {mode === "signin" ? "Não tem conta? Criar uma" : "Já tem conta? Entrar"}
        </button>
      </div>
    </main>
  );
}

function Field({
  type,
  placeholder,
  value,
  onChange,
  minLength,
}: {
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
}) {
  return (
    <input
      type={type}
      required
      minLength={minLength}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border bg-surface/60 px-4 py-3 text-text placeholder:text-text-faint transition-colors focus:border-amber focus:bg-surface focus:outline-none"
    />
  );
}
