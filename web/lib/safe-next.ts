/** Aceita só caminho interno: começa com exatamente um "/", sem esquema/host. */
export function safeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  // um único "/" inicial; bloqueia "//host", "/\host", esquemas e userinfo
  if (!/^\/(?![/\\])/.test(raw)) return "/dashboard";
  return raw;
}
