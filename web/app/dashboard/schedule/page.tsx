import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";

const EDITABLE = new Set(["queued", "failed"]);

export default async function SchedulePage() {
  const supabase = await createClient();
  const { data: posts } = await supabase
    .from("posts")
    .select("id, scheduled_at, status, ig_media_id, media:media_id(caption)")
    .order("scheduled_at", { ascending: true });

  return (
    <>
      <PageHeader eyebrow="● agenda" title="Fila & agendamento" />

      {posts && posts.length > 0 ? (
        <Card className="divide-y divide-border p-0">
          {posts.map((p) => {
            const editable = EDITABLE.has(p.status);
            const inner = (
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="font-mono text-sm">
                    {new Date(p.scheduled_at).toLocaleString("pt-BR")}
                  </p>
                  <p className="text-sm text-text-faint">
                    {/* @ts-expect-error relação retorna objeto */}
                    {p.media?.caption || "sem legenda"}
                  </p>
                </div>
                <span className="flex items-center gap-3">
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
      ) : (
        <EmptyState
          title="Fila vazia"
          hint="Quando você agendar uma foto, ela aparece aqui e é publicada sozinha no horário marcado."
        />
      )}
    </>
  );
}
