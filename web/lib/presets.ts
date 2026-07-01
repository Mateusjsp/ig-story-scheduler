// Style presets — contrato de estilo do caption, espelha o StyleConfig do
// image-service (image-service/app/imaging/style.py). O painel resolve o preset
// escolhido pra este objeto e manda como JSON (campo `style`) pro /preview e
// /process. O serviço de imagem valida de novo (Pydantic) — aqui a validação é
// leve, só pra UX.

export type FontKey = "sans-bold" | "serif" | "condensed" | "mono";
export type Position = "auto" | "top" | "center" | "bottom";

export interface Scrim {
  enabled: boolean;
  color: string; // #RRGGBB
  opacity: number; // 0-255
  adaptive: boolean; // mede luminância local; ignora opacity
}

export interface Outline {
  enabled: boolean;
  color: string; // #RRGGBB
  width: number; // 0-20
}

export interface StyleConfig {
  font: FontKey;
  text_color: string; // #RRGGBB
  scrim: Scrim;
  outline: Outline;
  position: Position;
  size_factor: number; // 0-0.2 (fração da largura)
}

export const FONT_LABELS: Record<FontKey, string> = {
  "sans-bold": "Sans (bold)",
  serif: "Serif",
  condensed: "Condensada",
  mono: "Mono",
};

export const POSITION_LABELS: Record<Position, string> = {
  auto: "Automática (ponto mais calmo)",
  top: "Topo",
  center: "Centro",
  bottom: "Rodapé",
};

// Estilo 'classic' — igual ao default do StyleConfig no back (visual histórico).
export const DEFAULT_STYLE: StyleConfig = {
  font: "sans-bold",
  text_color: "#FFFFFF",
  scrim: { enabled: true, color: "#000000", opacity: 110, adaptive: true },
  outline: { enabled: false, color: "#000000", width: 3 },
  position: "auto",
  size_factor: 0.066,
};

export interface BuiltinPreset {
  id: string; // "builtin:<slug>"
  name: string;
  config: StyleConfig;
}

// Presets embutidos: sempre disponíveis, não vivem no banco. Servem de ponto de
// partida e cobrem o caso comum sem o usuário precisar montar nada.
export const BUILTIN_PRESETS: BuiltinPreset[] = [
  { id: "builtin:classic", name: "Clássico", config: DEFAULT_STYLE },
  {
    id: "builtin:bold-yellow",
    name: "Amarelo forte",
    config: {
      font: "sans-bold",
      text_color: "#FFD400",
      scrim: { enabled: false, color: "#000000", opacity: 110, adaptive: true },
      outline: { enabled: true, color: "#000000", width: 4 },
      position: "bottom",
      size_factor: 0.075,
    },
  },
  {
    id: "builtin:minimal",
    name: "Minimalista",
    config: {
      font: "condensed",
      text_color: "#FFFFFF",
      scrim: { enabled: false, color: "#000000", opacity: 110, adaptive: true },
      outline: { enabled: true, color: "#000000", width: 2 },
      position: "top",
      size_factor: 0.05,
    },
  },
  {
    id: "builtin:serif-card",
    name: "Serif cartão",
    config: {
      font: "serif",
      text_color: "#FFFFFF",
      scrim: { enabled: true, color: "#101010", opacity: 200, adaptive: false },
      outline: { enabled: false, color: "#000000", width: 3 },
      position: "center",
      size_factor: 0.06,
    },
  },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Validação leve (o back valida de verdade). Retorna erro legível ou null. */
export function validateStyle(s: StyleConfig): string | null {
  if (!HEX.test(s.text_color)) return "Cor do texto inválida";
  if (!HEX.test(s.scrim.color)) return "Cor do scrim inválida";
  if (!HEX.test(s.outline.color)) return "Cor do contorno inválida";
  if (s.scrim.opacity < 0 || s.scrim.opacity > 255) return "Opacidade fora de 0–255";
  if (s.outline.width < 0 || s.outline.width > 20) return "Contorno fora de 0–20";
  if (s.size_factor <= 0 || s.size_factor > 0.2) return "Tamanho fora do intervalo";
  return null;
}

/** Preenche faltantes com o default — tolera config vinda do banco/versão antiga. */
export function normalizeStyle(raw: Partial<StyleConfig> | null | undefined): StyleConfig {
  return {
    ...DEFAULT_STYLE,
    ...raw,
    scrim: { ...DEFAULT_STYLE.scrim, ...raw?.scrim },
    outline: { ...DEFAULT_STYLE.outline, ...raw?.outline },
  };
}
