import { describe, it, expect } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("permite caminhos internos", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/reset-password")).toBe("/reset-password");
    expect(safeNext("/dashboard/schedule/123")).toBe("/dashboard/schedule/123");
  });

  it("cai no default quando ausente/vazio", () => {
    expect(safeNext(null)).toBe("/dashboard");
    expect(safeNext("")).toBe("/dashboard");
  });

  it("rejeita alvos externos e esquemas", () => {
    for (const bad of ["//evil.com", "/\\evil.com", ".evil.com", "https://evil.com", "@evil.com", "evil.com"]) {
      expect(safeNext(bad)).toBe("/dashboard");
    }
  });
});
