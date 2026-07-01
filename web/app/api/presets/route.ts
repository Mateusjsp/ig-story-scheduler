import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeStyle, validateStyle } from "@/lib/presets";

// GET  /api/presets       -> lista os presets do usuário
// POST /api/presets       -> cria um preset { name, config, is_default? }
// RLS garante owner = auth.uid(); ainda assim filtramos por owner explicitamente.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const { data, error } = await supabase
    .from("style_presets")
    .select("id, name, config, is_default, created_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ presets: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });

  const config = normalizeStyle(body?.config);
  const invalid = validateStyle(config);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const isDefault = body?.is_default === true;
  // Só um default por usuário (índice parcial). Zera os outros antes.
  if (isDefault) {
    await supabase
      .from("style_presets")
      .update({ is_default: false })
      .eq("owner", user.id)
      .eq("is_default", true);
  }

  const { data, error } = await supabase
    .from("style_presets")
    .insert({ owner: user.id, name, config, is_default: isDefault })
    .select("id, name, config, is_default, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ preset: data }, { status: 201 });
}
