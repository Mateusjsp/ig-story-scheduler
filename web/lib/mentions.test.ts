import { describe, it, expect } from "vitest";
import {
  newUserTag,
  sanitizeUsername,
  validateUserTags,
  rankUsernames,
  filterSuggestions,
  MAX_USER_TAGS,
  type UserTag,
} from "./mentions";

const tag = (username: string): UserTag => ({ username, x: 0.5, y: 0.5 });

describe("sanitizeUsername", () => {
  it("tira @, espaços e maiúsculas", () => {
    expect(sanitizeUsername("  @Fulano_Da_Silva ")).toBe("fulano_da_silva");
  });
  it("remove caracteres inválidos", () => {
    expect(sanitizeUsername("jo@ão!#silva")).toBe("joosilva");
  });
  it("corta em 30 chars", () => {
    expect(sanitizeUsername("a".repeat(40))).toHaveLength(30);
  });
});

describe("newUserTag", () => {
  it("cria tag válida com posição default no centro", () => {
    expect(newUserTag("@fulano")).toEqual({ username: "fulano", x: 0.5, y: 0.5 });
  });
  it("clampa x/y em 0..1", () => {
    expect(newUserTag("fulano", 2, -1)).toEqual({ username: "fulano", x: 1, y: 0 });
  });
  it("retorna null pra username vazio/inválido", () => {
    expect(newUserTag("@@@")).toBeNull();
    expect(newUserTag("   ")).toBeNull();
  });
});

describe("validateUserTags", () => {
  const ok: UserTag = { username: "fulano", x: 0.5, y: 0.5 };

  it("aceita lista válida", () => {
    expect(validateUserTags([ok])).toBeNull();
  });
  it("rejeita posição fora da imagem", () => {
    expect(validateUserTags([{ username: "x", x: 1.5, y: 0.5 }])).toMatch(/fora da imagem/);
  });
  it("rejeita duplicados", () => {
    expect(validateUserTags([ok, { ...ok }])).toMatch(/duplicidade/);
  });
  it("rejeita acima do limite", () => {
    const many = Array.from({ length: MAX_USER_TAGS + 1 }, (_, i) => ({ username: `u${i}`, x: 0.5, y: 0.5 }));
    expect(validateUserTags(many)).toMatch(/No máximo/);
  });
});

describe("rankUsernames", () => {
  it("ordena por frequência e depois alfabético", () => {
    const rows = [
      [tag("ana"), tag("bruno")],
      [tag("bruno")],
      [tag("bruno"), tag("ana")],
    ];
    // bruno=3, ana=2
    expect(rankUsernames(rows)).toEqual(["bruno", "ana"]);
  });
  it("deduplica e ignora inválidos/linhas nulas", () => {
    const rows = [[tag("ana"), tag("@@@")], null, [tag("ANA")]];
    expect(rankUsernames(rows)).toEqual(["ana"]);
  });
});

describe("filterSuggestions", () => {
  const sug = ["ana", "anabela", "bruno", "carla"];
  it("filtra por substring e ignora @ / maiúsculas no rascunho", () => {
    expect(filterSuggestions(sug, "@ANA", [])).toEqual(["ana", "anabela"]);
  });
  it("tira quem já está marcado", () => {
    expect(filterSuggestions(sug, "ana", ["ana"])).toEqual(["anabela"]);
  });
  it("rascunho vazio devolve tudo (até o limite)", () => {
    expect(filterSuggestions(sug, "", [], 2)).toEqual(["ana", "anabela"]);
  });
});
