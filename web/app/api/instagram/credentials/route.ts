import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/crypto";

// Salva (upsert) as credenciais do app Meta do usuário: App ID + App Secret.
// Secret é cifrado antes de gravar. RLS garante owner = auth.uid().
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const appId = typeof body?.appId === "string" ? body.appId.trim() : "";
  const appSecret = typeof body?.appSecret === "string" ? body.appSecret.trim() : "";

  if (!appId) {
    return NextResponse.json({ error: "App ID obrigatório" }, { status: 400 });
  }

  const row: Record<string, string> = { owner: user.id, app_id: appId };

  // Secret é opcional na edição: em branco mantém o valor atual.
  if (appSecret) {
    row.app_secret_enc = encryptToken(appSecret);
  } else {
    const { data: existing } = await supabase
      .from("ig_app_credentials")
      .select("app_secret_enc")
      .eq("owner", user.id)
      .maybeSingle();
    if (!existing?.app_secret_enc) {
      return NextResponse.json({ error: "App Secret obrigatório" }, { status: 400 });
    }
    row.app_secret_enc = existing.app_secret_enc;
  }

  const { error } = await supabase
    .from("ig_app_credentials")
    .upsert(row, { onConflict: "owner" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
