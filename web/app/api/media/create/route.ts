import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { docCaption, TARGETS, type StoryDoc, type Target } from "@/lib/story-doc";
import { validateUserTags, type UserTag } from "@/lib/mentions";

// Trata a imagem (image-service /process -> URL pública) e cria media + post agendado.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  // `doc` = documento de camadas do editor (JSON). Tem precedência sobre caption.
  const docRaw = (form.get("doc") as string) || null;
  const caption = (form.get("caption") as string) || null;
  // `style` é o JSON do preset resolvido no front (caminho legado single-caption).
  const style = (form.get("style") as string) || null;
  const accountId = form.get("account_id") as string;
  // Destino: 'story' (default) | 'feed_45' | 'feed_11'. Valida contra TARGETS.
  const targetRaw = (form.get("target") as string) || "story";
  const target: Target = targetRaw in TARGETS ? (targetRaw as Target) : "story";
  const meta = TARGETS[target];
  // Legenda de texto real (só feed).
  const feedCaption = meta.isFeed ? (form.get("feed_caption") as string) || null : null;
  // Marcações de pessoas (@) — JSON [{username,x,y}]. Vale pra feed e story.
  const userTagsRaw = (form.get("user_tags") as string) || null;
  const scheduledAt = form.get("scheduled_at") as string | null;
  // "Postar agora": enfileira com scheduled_at = agora; o scheduler publica no
  // próximo ciclo (~1 min), reusando o mesmo caminho atômico do agendamento.
  const immediate = form.get("now") === "1";

  if (!(file instanceof Blob) || !accountId) {
    return NextResponse.json({ error: "dados incompletos" }, { status: 400 });
  }

  // A conta precisa ser do próprio usuário (RLS já filtra ig_accounts por owner).
  const { data: account } = await supabase
    .from("ig_accounts")
    .select("id")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: "conta não encontrada" }, { status: 404 });
  }

  // Parse único e ANTES do /process: doc/style malformado não pode subir imagem
  // pro Storage e só então estourar (deixaria objetos órfãos + 500 genérico).
  let parsedDoc: StoryDoc | null = null;
  if (docRaw) {
    try {
      parsedDoc = JSON.parse(docRaw) as StoryDoc;
    } catch {
      return NextResponse.json({ error: "doc inválido (JSON malformado)" }, { status: 400 });
    }
  }
  let parsedStyle: unknown = null;
  if (style) {
    try {
      parsedStyle = JSON.parse(style);
    } catch {
      return NextResponse.json({ error: "style inválido (JSON malformado)" }, { status: 400 });
    }
  }
  let userTags: UserTag[] = [];
  if (userTagsRaw) {
    try {
      userTags = JSON.parse(userTagsRaw) as UserTag[];
    } catch {
      return NextResponse.json({ error: "marcações inválidas (JSON malformado)" }, { status: 400 });
    }
    const invalid = validateUserTags(userTags);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  }

  let scheduledDate: Date;
  if (immediate) {
    scheduledDate = new Date();
  } else {
    if (!scheduledAt) {
      return NextResponse.json({ error: "dados incompletos" }, { status: 400 });
    }
    scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      return NextResponse.json(
        { error: "data de agendamento inválida" },
        { status: 400 },
      );
    }
    if (scheduledDate.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "o horário precisa ser no futuro" },
        { status: 400 },
      );
    }
  }

  const base = process.env.IMAGE_SERVICE_URL;
  if (!base) return NextResponse.json({ error: "IMAGE_SERVICE_URL ausente" }, { status: 500 });

  // 1. trata + sobe pro Storage
  const fd = new FormData();
  fd.append("owner", user.id);
  fd.append("file", file);
  if (docRaw) fd.append("doc", docRaw);
  if (caption) fd.append("caption", caption);
  if (style) fd.append("style", style);
  fd.append("target", target);
  let procRes: Response;
  try {
    procRes = await fetch(`${base}/process`, {
      method: "POST",
      body: fd,
      headers: { "X-Service-Token": process.env.SERVICE_SHARED_SECRET ?? "" },
      // evita spinner infinito se o image-service estiver lento/inalcançável
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "tempo esgotado" : "sem resposta";
    return NextResponse.json(
      { error: `image-service indisponível (${reason})` },
      { status: 504 },
    );
  }
  if (!procRes.ok) {
    return NextResponse.json(
      { error: `tratamento falhou: ${await procRes.text()}` },
      { status: 502 },
    );
  }
  const processed = await procRes.json();

  // 2. cria media
  const { data: media, error: mErr } = await supabase
    .from("media")
    .insert({
      owner: user.id,
      account_id: accountId,
      // com doc, a legenda guardada é o texto concatenado dos elementos.
      caption: parsedDoc ? docCaption(parsedDoc) || null : caption,
      doc: parsedDoc,
      // style guardado pra permitir editar depois (reprocessar). null = 'classic'.
      style: parsedStyle,
      original_path: processed.original_path,
      original_url: processed.original_url,
      processed_path: processed.processed_path,
      processed_url: processed.processed_url,
      width: processed.width,
      height: processed.height,
      feed_caption: feedCaption,
      user_tags: userTags,
      aspect: meta.aspectLabel,
      status: "processed",
    })
    .select("id")
    .single();
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

  // 3. agenda o post
  const { error: pErr } = await supabase.from("posts").insert({
    owner: user.id,
    account_id: accountId,
    media_id: media.id,
    scheduled_at: scheduledDate.toISOString(),
    target: meta.postTarget,
    status: "queued",
  });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, immediate });
}
