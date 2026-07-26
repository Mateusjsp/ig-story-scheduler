import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchMentionSuggestions } from "@/lib/mentions-server";
import { PageHeader } from "@/components/ui";
import { docFromLegacy, type StoryDoc } from "@/lib/story-doc";
import { type StyleConfig } from "@/lib/presets";
import { type UserTag } from "@/lib/mentions";
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
      "id, scheduled_at, status, account_id, error, target, media:media_id(caption, style, doc, processed_url, original_url, original_path, aspect, feed_caption, user_tags)",
    )
    .eq("id", id)
    .single();
  if (!post) notFound();

  const { data: accounts } = await supabase
    .from("ig_accounts")
    .select("id, username, ig_user_id")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  const mentionSuggestions = await fetchMentionSuggestions();

  const media = (Array.isArray(post.media) ? post.media[0] : post.media) as {
    caption: string | null;
    style: StyleConfig | null;
    doc: StoryDoc | null;
    processed_url: string | null;
    original_url: string | null;
    original_path: string | null;
    aspect: string | null;
    feed_caption: string | null;
    user_tags: UserTag[] | null;
  } | null;

  const initialDoc = media?.doc ?? docFromLegacy(media?.caption, media?.style);

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
          doc: initialDoc,
          bg_url: media?.original_url ?? media?.processed_url ?? null,
          has_original: !!media?.original_path,
          aspect: media?.aspect ?? null,
          feed_caption: media?.feed_caption ?? null,
          user_tags: media?.user_tags ?? [],
        }}
        accounts={(accounts ?? []).map((a) => ({
          id: a.id,
          label: a.username ? `@${a.username}` : a.ig_user_id,
        }))}
        mentionSuggestions={mentionSuggestions}
      />
    </>
  );
}
