import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";
import { PostThumb } from "./post-thumb";

const EDITABLE = new Set(["queued", "failed"]);

type MediaRel = {
  caption: string | null;
  processed_url: string | null;
  original_url: string | null;
} | null;
type AccountRel = { username: string | null; ig_user_id: string } | null;

// Rótulo do dia: "hoje", "amanhã" ou data curta.
function dayLabel(d: Date): string {
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff === -1) return "ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });
}

export default async function SchedulePage() {
  const supabase = await createClient();
  const { data: posts } = await supabase
    .from("posts")
    .select(
      "id, scheduled_at, status, ig_media_id, account:account_id(username, ig_user_id), media:media_id(caption, processed_url, original_url)",
    )
    .order("scheduled_at", { ascending: true });

  // agrupa por dia mantendo a ordem cronológica
  const list = posts ?? [];
  const groups = new Map<string, typeof list>();
  for (const p of list) {
    const key = dayLabel(new Date(p.scheduled_at));
    const bucket = groups.get(key) ?? groups.set(key, []).get(key)!;
    bucket.push(p);
  }

  return (
    <>
      <PageHeader eyebrow="● agenda" title="Fila & agendamento" />

      {posts && posts.length > 0 ? (
        <div className="space-y-8">
          {[...groups].map(([day, items]) => (
            <section key={day}>
              <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-text-faint">
                {day}
                <span className="ml-2 text-text-faint/60">{items.length}</span>
              </h2>
              <Card className="divide-y divide-border p-0">
                {items.map((p) => {
                  const editable = EDITABLE.has(p.status);
                  const media = (Array.isArray(p.media) ? p.media[0] : p.media) as MediaRel;
                  const account = (Array.isArray(p.account) ? p.account[0] : p.account) as AccountRel;
                  const thumb = media?.processed_url ?? media?.original_url ?? null;
                  const handle = account?.username ? `@${account.username}` : account?.ig_user_id;

                  const inner = (
                    <div className="flex items-center gap-4 px-5 py-3.5">
                      <PostThumb src={thumb} />

                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm tabular-nums">
                          {new Date(p.scheduled_at).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {handle && (
                            <span className="ml-2 text-text-faint">· {handle}</span>
                          )}
                        </p>
                        <p className="truncate text-sm text-text-dim">
                          {media?.caption || "sem legenda"}
                        </p>
                      </div>

                      <span className="flex shrink-0 items-center gap-3">
                        <Badge status={p.status} />
                        {editable && <span aria-hidden className="text-text-faint">›</span>}
                      </span>
                    </div>
                  );

                  return editable ? (
                    <Link
                      key={p.id}
                      href={`/dashboard/schedule/${p.id}`}
                      className="block transition-colors hover:bg-surface/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={p.id}>{inner}</div>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Fila vazia"
          hint="Quando você agendar uma foto, ela aparece aqui e é publicada sozinha no horário marcado."
        />
      )}
    </>
  );
}
