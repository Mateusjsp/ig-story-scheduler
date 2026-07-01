import { NextResponse } from "next/server";

// Proxy da TTF servida pelo image-service (/fonts/:key). Assim o editor usa no
// browser (@font-face) exatamente a mesma fonte que o render server usa — o
// preview ao vivo bate com a imagem publicada. Mantém IMAGE_SERVICE_URL no server.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const base = process.env.IMAGE_SERVICE_URL;
  if (!base) return new NextResponse("IMAGE_SERVICE_URL ausente", { status: 500 });

  const res = await fetch(`${base}/fonts/${encodeURIComponent(key)}`);
  if (!res.ok) return new NextResponse("fonte indisponível", { status: res.status });

  return new NextResponse(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "font/ttf",
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}
