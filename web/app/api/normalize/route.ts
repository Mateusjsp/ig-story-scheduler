import { NextResponse, type NextRequest } from "next/server";

// Proxy pro image-service /normalize: devolve um JPEG reduzido da foto (abre HEIC
// de iPhone) pro editor exibir no browser. Mantém IMAGE_SERVICE_URL no server.
export async function POST(request: NextRequest) {
  const incoming = await request.formData();
  const base = process.env.IMAGE_SERVICE_URL;
  if (!base) {
    return NextResponse.json({ error: "IMAGE_SERVICE_URL não configurado." }, { status: 500 });
  }

  const res = await fetch(`${base}/normalize`, {
    method: "POST",
    body: incoming,
    headers: { "X-Service-Token": process.env.SERVICE_SHARED_SECRET ?? "" },
  });
  if (!res.ok) {
    return NextResponse.json({ error: await res.text() }, { status: res.status });
  }
  return new NextResponse(res.body, {
    headers: { "content-type": res.headers.get("content-type") ?? "image/jpeg" },
  });
}
