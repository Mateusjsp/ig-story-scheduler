import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";

// Inicia o OAuth do Instagram (login do Instagram). Gera `state` (anti-CSRF),
// guarda em cookie httpOnly e redireciona pra Meta.
export async function GET(request: NextRequest) {
  const appId = process.env.INSTAGRAM_APP_ID;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  if (!appId) {
    return NextResponse.json(
      { error: "INSTAGRAM_APP_ID não configurado." },
      { status: 500 },
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${site}/api/instagram/callback`;
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
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
