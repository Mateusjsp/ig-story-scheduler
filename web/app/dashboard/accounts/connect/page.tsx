import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { CredentialsForm } from "./credentials-form";

const REQUIREMENTS = [
  {
    glyph: "◍",
    title: "Conta Business ou Creator",
    body: "Sua conta do Instagram precisa ser Profissional (Business ou Creator). Perfis pessoais não têm acesso à API de publicação.",
  },
  {
    glyph: "▦",
    title: "App no Meta for Developers",
    body: "Crie um app em developers.facebook.com com o produto Instagram (API com login do Instagram) e pegue o App ID + App Secret.",
  },
  {
    glyph: "◷",
    title: "Redirect autorizado",
    body: "No app do Meta, libere a URL de redirecionamento OAuth: {SITE}/api/instagram/callback.",
  },
];

// Passo a passo de onde achar as credenciais no painel da Meta.
const WHERE = [
  "Acesse developers.facebook.com → Meus apps → selecione (ou crie) seu app.",
  "No menu, abra Instagram → API setup with Instagram login.",
  "Na seção “2. Set up Instagram business login”, copie o Instagram app ID e o Instagram app secret.",
  "ATENÇÃO: não use o “App ID” do topo do painel (esse é o do app Meta/Facebook). Precisa ser o Instagram app ID desta seção — senão a Meta responde “Invalid platform app”.",
];

export default async function ConnectInstructionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: creds } = user
    ? await supabase
        .from("ig_app_credentials")
        .select("app_id")
        .eq("owner", user.id)
        .maybeSingle()
    : { data: null };

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  return (
    <>
      <PageHeader eyebrow="● contas" title="Conectar Instagram" />

      <div className="max-w-xl space-y-4">
        <p className="text-sm text-text-dim">
          Cadastre as credenciais do seu app do Meta. Elas ficam salvas na sua
          conta (o App Secret é cifrado) e são usadas no login seguro da Meta.
        </p>

        <div className="space-y-3">
          {REQUIREMENTS.map((r) => (
            <Card key={r.title} className="flex gap-4">
              <span aria-hidden="true" className="text-xl text-amber">{r.glyph}</span>
              <div>
                <p className="font-display text-lg">{r.title}</p>
                <p className="mt-1 text-sm text-text-dim">
                  {r.body.replace("{SITE}", site || "https://seu-site")}
                </p>
              </div>
            </Card>
          ))}
        </div>

        <Card className="space-y-3">
          <p className="font-display text-lg">Onde pegar o App ID + App Secret</p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-text-dim marker:text-amber">
            {WHERE.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <a
            href="https://developers.facebook.com/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-sm text-sm text-amber underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Abrir Meta for Developers ↗
          </a>
        </Card>

        <CredentialsForm
          initialAppId={creds?.app_id ?? ""}
          hasSecret={Boolean(creds?.app_id)}
        />
      </div>
    </>
  );
}
