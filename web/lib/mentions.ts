// Marcação de pessoas (@menção) — metadata de publicação enviada à Meta como
// `user_tags` (não é renderizada no pixel). Vale pra feed (x/y obrigatórios) e
// story (menção; x/y opcionais, mas guardamos a posição pra reusar). Espelha o
// que o scheduler lê de media.user_tags e passa ao GraphApiPublisher.

export interface UserTag {
  username: string; // sem '@'
  x: number; // 0..1 (fração da largura, a partir da esquerda)
  y: number; // 0..1 (fração da altura, a partir do topo)
}

// IG aceita até 20 pessoas marcadas por publicação.
export const MAX_USER_TAGS = 20;

const USERNAME_RE = /^[a-z0-9._]{1,30}$/;

/** Normaliza o que o usuário digitou pra um username IG válido (ou "" se inválido).
 *  Tira '@', espaços, deixa minúsculo e mantém só [a-z0-9._]. */
export function sanitizeUsername(raw: string): string {
  const s = raw.trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9._]/g, "");
  return s.slice(0, 30);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Cria uma marcação a partir de um username cru + posição (default centro). */
export function newUserTag(rawUsername: string, x = 0.5, y = 0.5): UserTag | null {
  const username = sanitizeUsername(rawUsername);
  if (!USERNAME_RE.test(username)) return null;
  return { username, x: clamp01(x), y: clamp01(y) };
}

/** Validação leve (a Meta valida de verdade). Retorna erro legível ou null. */
export function validateUserTags(tags: UserTag[]): string | null {
  if (!Array.isArray(tags)) return "Marcações inválidas";
  if (tags.length > MAX_USER_TAGS) return `No máximo ${MAX_USER_TAGS} pessoas marcadas`;
  for (const t of tags) {
    if (!USERNAME_RE.test(t.username)) return `@${t.username}: usuário inválido`;
    if (t.x < 0 || t.x > 1 || t.y < 0 || t.y > 1) return "Posição da marcação fora da imagem";
  }
  const names = tags.map((t) => t.username);
  if (new Set(names).size !== names.length) return "Pessoa marcada em duplicidade";
  return null;
}
