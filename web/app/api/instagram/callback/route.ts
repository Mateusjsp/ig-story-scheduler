import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptToken, decryptToken } from "@/lib/crypto";

// Callback do OAuth: code -> token curto -> token longo (60d) -> salva ig_account.
export async function GET(request: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const dest = (q: string) => {
    const r = NextResponse.redirect(`${origin}/dashboard/accounts?${q}`);
    r.cookies.delete("ig_oauth_state");
    return r;
  };

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return dest("error=sem_code");

  // Anti-CSRF: o `state` da query precisa bater com o cookie setado no /start.
  const state = request.nextUrl.searchParams.get("state");
  const cookieState = request.cookies.get("ig_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) {
    return dest("error=state_invalido");
  }

  const redirectUri = `${origin}/api/instagram/callback`;

  try {
    // Credenciais do app vêm do banco (por owner), não de env.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.redirect(`${origin}/login`);

    const { data: creds } = await supabase
      .from("ig_app_credentials")
      .select("app_id, app_secret_enc")
      .eq("owner", user.id)
      .maybeSingle();
    if (!creds?.app_id || !creds?.app_secret_enc) {
      return dest("error=sem_credenciais");
    }
    const appId = creds.app_id;
    const appSecret = decryptToken(creds.app_secret_enc);

    // 1. code -> token curto (+ user_id)
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    if (!shortRes.ok) throw new Error(await shortRes.text());
    const short = await shortRes.json();

    // 2. token curto -> token longo (~60 dias)
    const longUrl = new URL("https://graph.instagram.com/access_token");
    longUrl.searchParams.set("grant_type", "ig_exchange_token");
    longUrl.searchParams.set("client_secret", appSecret);
    longUrl.searchParams.set("access_token", short.access_token);
    const longRes = await fetch(longUrl);
    if (!longRes.ok) throw new Error(await longRes.text());
    const long = await longRes.json();
    const token: string = long.access_token;
    const expiresAt = new Date(Date.now() + (long.expires_in ?? 0) * 1000);

    // 3. /me -> username + ig_user_id
    const meUrl = new URL("https://graph.instagram.com/me");
    meUrl.searchParams.set("fields", "user_id,username");
    meUrl.searchParams.set("access_token", token);
    const me = await (await fetch(meUrl)).json();

    // 4. salva (RLS: owner = auth.uid()). Upsert por (owner, ig_user_id).
    const { error } = await supabase.from("ig_accounts").upsert(
      {
        owner: user.id,
        ig_user_id: String(me.user_id ?? short.user_id),
        username: me.username ?? null,
        access_token_enc: encryptToken(token),
        token_expires_at: expiresAt.toISOString(),
        status: "active",
      },
      { onConflict: "owner,ig_user_id" },
    );
    if (error) throw new Error(error.message);

    return dest("ok=1");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro";
    return dest(`error=${encodeURIComponent(msg.slice(0, 120))}`);
  }
}
