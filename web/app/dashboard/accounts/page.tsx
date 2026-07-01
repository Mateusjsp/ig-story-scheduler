import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data: accounts } = await supabase
    .from("ig_accounts")
    .select("id, username, ig_user_id, status, token_expires_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader eyebrow="● contas" title="Contas do Instagram">
        <Link
          href="/dashboard/accounts/connect"
          className="inline-flex items-center gap-2 rounded-md bg-amber px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-amber-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <span aria-hidden="true">＋</span> Conectar Instagram
        </Link>
      </PageHeader>

      {accounts && accounts.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          {accounts.map((a) => (
            <Card key={a.id} className="flex items-center justify-between">
              <div>
                <p className="font-display text-lg">@{a.username ?? a.ig_user_id}</p>
                <p className="font-mono text-xs text-text-faint">
                  expira{" "}
                  {a.token_expires_at
                    ? new Date(a.token_expires_at).toLocaleDateString("pt-BR")
                    : "—"}
                </p>
              </div>
              <Badge status={a.status} />
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nenhuma conta conectada"
          hint="Conecte uma conta Business do Instagram via login da Meta pra começar a agendar Stories."
        />
      )}
    </>
  );
}
