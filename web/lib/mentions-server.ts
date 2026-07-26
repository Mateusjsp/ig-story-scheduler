import "server-only";
import { createClient } from "./supabase/server";
import { rankUsernames, type UserTag } from "./mentions";

// Autocomplete de marcação (@): quem o dono já marcou antes. Lê media.user_tags
// (RLS já filtra por owner) e ranqueia por frequência. Alimenta o dropdown do
// StoryEditor — evita redigitar e mata erro de digitação em @ recorrentes.
export async function fetchMentionSuggestions(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("media")
    .select("user_tags")
    .order("created_at", { ascending: false })
    .limit(500);
  if (!data) return [];
  return rankUsernames(data.map((r) => r.user_tags as UserTag[] | null));
}
