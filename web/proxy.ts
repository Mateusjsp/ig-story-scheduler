import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next 16: a convenção `middleware` virou `proxy`. Renova a sessão Supabase
// e protege rotas (sem usuário -> /login).
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg)$).*)"],
};
