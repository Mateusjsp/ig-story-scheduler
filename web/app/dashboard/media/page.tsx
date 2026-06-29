import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { Uploader } from "./uploader";

export default async function MediaPage() {
  const supabase = await createClient();
  const { data: accounts } = await supabase
    .from("ig_accounts")
    .select("id, username, ig_user_id")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader eyebrow="● mídia" title="Estúdio" />
      <p className="mb-6 max-w-xl text-sm text-text-dim">
        Suba uma foto e escreva a legenda. O preview mostra o tratamento: 9:16 com
        fundo desfocado e o texto no ponto mais calmo da imagem, desviando de rostos.
      </p>

      {accounts && accounts.length > 0 ? (
        <Uploader
          accounts={accounts.map((a) => ({
            id: a.id,
            label: a.username ? `@${a.username}` : a.ig_user_id,
          }))}
        />
      ) : (
        <p className="text-sm text-text-dim">
          Conecte uma conta em{" "}
          <Link href="/dashboard/accounts" className="text-amber underline">
            Contas
          </Link>{" "}
          antes de agendar.
        </p>
      )}
    </>
  );
}
