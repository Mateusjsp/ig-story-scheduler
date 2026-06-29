import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, StatTile, Card, Badge } from "@/components/ui";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ count: accounts }, { count: queued }, { data: recent }] =
    await Promise.all([
      supabase.from("ig_accounts").select("*", { count: "exact", head: true }),
      supabase
        .from("posts")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued"),
      supabase
        .from("posts")
        .select("id, status, scheduled_at, ig_media_id")
        .order("scheduled_at", { ascending: false })
        .limit(6),
    ]);

  return (
    <>
      <PageHeader eyebrow="● painel" title="Visão geral" />

      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Contas" value={accounts ?? 0} />
        <StatTile label="Na fila" value={queued ?? 0} />
        <StatTile label="Próxima" value={<NextLabel iso={recent?.[0]?.scheduled_at} />} />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-xl">Atividade recente</h2>
        {recent && recent.length > 0 ? (
          <Card className="divide-y divide-border p-0">
            {recent.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3">
                <span className="font-mono text-sm text-text-dim">
                  {new Date(p.scheduled_at).toLocaleString("pt-BR")}
                </span>
                <Badge status={p.status} />
              </div>
            ))}
          </Card>
        ) : (
          <Card className="text-sm text-text-dim">
            Nada ainda. Conecte uma conta e suba sua primeira foto em{" "}
            <Link href="/dashboard/accounts" className="text-amber underline">
              Contas
            </Link>
            .
          </Card>
        )}
      </section>
    </>
  );
}

function NextLabel({ iso }: { iso?: string }) {
  if (!iso) return <span className="text-text-faint">—</span>;
  return (
    <span className="text-2xl">
      {new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
    </span>
  );
}
