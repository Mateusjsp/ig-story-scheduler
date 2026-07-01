import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";

// Inicia o OAuth do Instagram (login do Instagram). Gera `state` (anti-CSRF),
// guarda em cookie httpOnly e redireciona pra Meta.
// O App ID vem das credenciais do usuário no banco (não de env).
export async function GET(request: NextRequest) {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${site}/login`);

  const { data: creds } = await supabase
    .from("ig_app_credentials")
    .select("app_id")
    .eq("owner", user.id)
    .maybeSingle();

  if (!creds?.app_id) {
    // Sem credenciais cadastradas: volta pra tela de conexão pra preencher.
    return NextResponse.redirect(
      `${site}/dashboard/accounts/connect?error=sem_credenciais`,
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${site}/api/instagram/callback`;
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", creds.app_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    "instagram_business_basic,instagram_business_content_publish",
  );
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min
  });
  return res;
}
