import { createBrowserClient } from "@supabase/ssr";

// Client do browser (componentes "use client"). Usa a anon key + RLS.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
