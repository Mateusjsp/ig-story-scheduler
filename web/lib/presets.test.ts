import { describe, it, expect } from "vitest";
import { validateStyle, normalizeStyle, DEFAULT_STYLE, type StyleConfig } from "./presets";

describe("validateStyle", () => {
  it("aceita o estilo default", () => {
    expect(validateStyle(DEFAULT_STYLE)).toBeNull();
  });

  it("rejeita cor, opacidade, contorno e tamanho fora do intervalo", () => {
    expect(validateStyle({ ...DEFAULT_STYLE, text_color: "vermelho" })).not.toBeNull();
    expect(validateStyle({ ...DEFAULT_STYLE, scrim: { ...DEFAULT_STYLE.scrim, opacity: 256 } })).not.toBeNull();
    expect(validateStyle({ ...DEFAULT_STYLE, outline: { ...DEFAULT_STYLE.outline, width: 21 } })).not.toBeNull();
    expect(validateStyle({ ...DEFAULT_STYLE, size_factor: 0.21 })).not.toBeNull();
  });

  it("rejeita font e position inválidas", () => {
    expect(validateStyle({ ...DEFAULT_STYLE, font: "comic" as StyleConfig["font"] })).toBe("Fonte inválida");
    expect(validateStyle({ ...DEFAULT_STYLE, position: "diagonal" as StyleConfig["position"] })).toBe("Posição inválida");
  });
});

describe("normalizeStyle", () => {
  it("null retorna o default", () => {
    expect(normalizeStyle(null)).toEqual(DEFAULT_STYLE);
  });

  it("descarta chaves desconhecidas e preenche faltantes", () => {
    const out = normalizeStyle({ font: "serif", lixo: 123 } as Partial<StyleConfig>);
    expect(out.font).toBe("serif");
    expect(out.position).toBe(DEFAULT_STYLE.position);
    expect("lixo" in out).toBe(false);
  });

  it("faz merge parcial dos sub-objetos", () => {
    const out = normalizeStyle({ scrim: { opacity: 200 } as StyleConfig["scrim"] });
    expect(out.scrim.opacity).toBe(200);
    expect(out.scrim.color).toBe(DEFAULT_STYLE.scrim.color);
  });
});
