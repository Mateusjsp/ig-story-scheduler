import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";

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
          {posts.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="font-mono text-sm">
                  {new Date(p.scheduled_at).toLocaleString("pt-BR")}
                </p>
                <p className="text-sm text-text-faint">
                  {/* @ts-expect-error relação retorna objeto */}
                  {p.media?.caption || "sem legenda"}
                </p>
              </div>
              <Badge status={p.status} />
            </div>
          ))}
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
