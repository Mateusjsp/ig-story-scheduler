import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { normalizeStyle, type StyleConfig } from "@/lib/presets";
import { PostEditor } from "./post-editor";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: post } = await supabase
    .from("posts")
    .select(
      "id, scheduled_at, status, account_id, error, media:media_id(caption, style, processed_url, original_path)",
    )
    .eq("id", id)
    .single();
  if (!post) notFound();

  const { data: accounts } = await supabase
    .from("ig_accounts")
    .select("id, username, ig_user_id")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const media = (Array.isArray(post.media) ? post.media[0] : post.media) as {
    caption: string | null;
    style: StyleConfig | null;
    processed_url: string | null;
    original_path: string | null;
  } | null;

  return (
    <>
      <PageHeader eyebrow="● agenda" title="Editar post" />
      <Link
        href="/dashboard/schedule"
        className="mb-6 inline-block text-sm text-text-dim underline-offset-4 hover:text-amber hover:underline"
      >
        ← voltar pra fila
      </Link>
      <PostEditor
        post={{
          id: post.id,
          scheduled_at: post.scheduled_at,
          status: post.status,
          account_id: post.account_id,
          error: post.error,
          caption: media?.caption ?? "",
          style: normalizeStyle(media?.style),
          processed_url: media?.processed_url ?? null,
          has_original: !!media?.original_path,
        }}
        accounts={(accounts ?? []).map((a) => ({
          id: a.id,
          label: a.username ? `@${a.username}` : a.ig_user_id,
        }))}
      />
    </>
  );
}
