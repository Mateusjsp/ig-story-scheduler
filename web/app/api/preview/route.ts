import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Proxy pro image-service: mantém IMAGE_SERVICE_URL no servidor e evita CORS.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const incoming = await request.formData();
  const base = process.env.IMAGE_SERVICE_URL;
  if (!base) {
    return NextResponse.json(
      { error: "IMAGE_SERVICE_URL não configurado." },
      { status: 500 },
    );
  }

  const res = await fetch(`${base}/preview`, {
    method: "POST",
    body: incoming,
    headers: { "X-Service-Token": process.env.SERVICE_SHARED_SECRET ?? "" },
  });
  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: `Falha no tratamento: ${detail}` },
      { status: res.status },
    );
  }

  return new NextResponse(res.body, {
    headers: { "content-type": res.headers.get("content-type") ?? "image/jpeg" },
  });
}
