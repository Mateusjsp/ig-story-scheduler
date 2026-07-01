import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeStyle, validateStyle } from "@/lib/presets";

// PUT    /api/presets/:id  -> atualiza { name?, config?, is_default? }
// DELETE /api/presets/:id  -> apaga
// RLS restringe ao owner; o filtro .eq("id") + RLS já isola.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "corpo inválido" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "nome vazio" }, { status: 400 });
    patch.name = name;
  }
  if (body.config !== undefined) {
    const config = normalizeStyle(body.config);
    const invalid = validateStyle(config);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    patch.config = config;
  }
  if (body.is_default === true) {
    // Só um default por usuário: zera os outros antes.
    await supabase
      .from("style_presets")
      .update({ is_default: false })
      .eq("owner", user.id)
      .eq("is_default", true);
    patch.is_default = true;
  } else if (body.is_default === false) {
    patch.is_default = false;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nada pra atualizar" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("style_presets")
    .update(patch)
    .eq("id", id)
    .select("id, name, config, is_default, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "não encontrado" }, { status: 404 });
  return NextResponse.json({ preset: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const { error } = await supabase.from("style_presets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
