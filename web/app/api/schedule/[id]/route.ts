import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeStyle, validateStyle, type StyleConfig } from "@/lib/presets";
import { docCaption, type StoryDoc } from "@/lib/story-doc";

// PUT    /api/schedule/:id  -> edita um post da fila (reagenda, troca conta,
//                             edita texto/estilo reprocessando, reenfileira)
// DELETE /api/schedule/:id  -> cancela (apaga o post e a mídia)
// Só posts editáveis: status 'queued' ou 'failed'. RLS isola por owner.

const EDITABLE = new Set(["queued", "failed"]);

type MediaRow = {
  id: string;
  caption: string | null;
  style: StyleConfig | null;
  doc: StoryDoc | null;
  original_path: string | null;
  processed_path: string | null;
};

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

  const { data: post, error: pErr } = await supabase
    .from("posts")
    .select("id, status, account_id, media_id, media:media_id(id, caption, style, doc, original_path, processed_path)")
    .eq("id", id)
    .single();
  if (pErr || !post) return NextResponse.json({ error: "post não encontrado" }, { status: 404 });
  if (!EDITABLE.has(post.status)) {
    return NextResponse.json(
      { error: "só dá pra editar posts na fila ou que falharam" },
      { status: 409 },
    );
  }
  const media = (Array.isArray(post.media) ? post.media[0] : post.media) as MediaRow;

  // ---- reprocesso: doc (editor de camadas) tem precedência sobre caption/style ----
  const docChanged =
    body.doc !== undefined &&
    JSON.stringify(body.doc) !== JSON.stringify(media.doc);
  const captionChanged =
    typeof body.caption === "string" && body.caption !== (media.caption ?? "");
  const styleChanged =
    body.style !== undefined &&
    JSON.stringify(normalizeStyle(body.style)) !==
      JSON.stringify(normalizeStyle(media.style));

  if (docChanged || captionChanged || styleChanged) {
    if (!media.original_path) {
      return NextResponse.json(
        { error: "esse post não tem a foto original salva — reenvie pela tela de Mídia" },
        { status: 422 },
      );
    }
    const base = process.env.IMAGE_SERVICE_URL;
    if (!base) return NextResponse.json({ error: "IMAGE_SERVICE_URL ausente" }, { status: 500 });

    const fd = new FormData();
    fd.append("owner", user.id);
    fd.append("original_path", media.original_path);
    if (media.processed_path) fd.append("old_processed_path", media.processed_path);

    const mediaPatch: Record<string, unknown> = {};
    if (docChanged) {
      const doc = body.doc as StoryDoc;
      fd.append("doc", JSON.stringify(doc));
      mediaPatch.doc = doc;
      mediaPatch.caption = docCaption(doc) || null;
    } else {
      // legado single-caption
      const newCaption = captionChanged ? (body.caption as string) : media.caption ?? "";
      const newStyle = normalizeStyle(styleChanged ? body.style : media.style);
      const invalid = validateStyle(newStyle);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      if (newCaption.trim()) fd.append("caption", newCaption.trim());
      fd.append("style", JSON.stringify(newStyle));
      mediaPatch.caption = newCaption || null;
      mediaPatch.style = newStyle;
    }

    let res: Response;
    try {
      res = await fetch(`${base}/reprocess`, {
        method: "POST",
        body: fd,
        headers: { "X-Service-Token": process.env.SERVICE_SHARED_SECRET ?? "" },
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      return NextResponse.json({ error: "image-service indisponível" }, { status: 504 });
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: `reprocesso falhou: ${await res.text()}` },
        { status: 502 },
      );
    }
    const rp = await res.json();
    mediaPatch.processed_path = rp.processed_path;
    mediaPatch.processed_url = rp.processed_url;
    const { error: mErr } = await supabase.from("media").update(mediaPatch).eq("id", media.id);
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });
  }

  // ---- update do post (reagendar, conta, reenfileirar) ----
  const patch: Record<string, unknown> = {};
  if (typeof body.scheduled_at === "string") {
    const when = new Date(body.scheduled_at);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: "data inválida" }, { status: 400 });
    }
    if (when.getTime() <= Date.now()) {
      return NextResponse.json({ error: "o horário precisa ser no futuro" }, { status: 400 });
    }
    patch.scheduled_at = when.toISOString();
  }
  if (typeof body.account_id === "string") patch.account_id = body.account_id;
  // reenfileirar um post que falhou: volta pra fila, zera erro/tentativas.
  if (body.reenqueue === true || (post.status === "failed" && patch.scheduled_at)) {
    patch.status = "queued";
    patch.error = null;
    patch.attempts = 0;
  }

  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await supabase.from("posts").update(patch).eq("id", id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
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

  const { data: post } = await supabase
    .from("posts")
    .select("status, media_id")
    .eq("id", id)
    .single();
  if (!post) return NextResponse.json({ error: "post não encontrado" }, { status: 404 });
  if (!EDITABLE.has(post.status)) {
    return NextResponse.json(
      { error: "só dá pra cancelar posts na fila ou que falharam" },
      { status: 409 },
    );
  }

  // Apaga a mídia -> cascata apaga o post (posts.media_id on delete cascade).
  const { error } = await supabase.from("media").delete().eq("id", post.media_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
