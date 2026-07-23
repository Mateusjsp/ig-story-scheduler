import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  docCaption,
  newStickerElement,
  newTextElement,
  targetFromAspect,
  type StoryDoc,
} from "./story-doc";

const FIXTURES = path.join(__dirname, "..", "..", "shared", "fixtures", "story-docs");
const readFixture = (name: string): StoryDoc =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf-8")) as StoryDoc;

describe("story-doc fixtures compartilhadas", () => {
  it("as 3 fixtures fazem parse com elementos", () => {
    for (const f of ["full.json", "minimal.json", "legacy-no-photo.json"]) {
      const doc = readFixture(f);
      expect(doc.version).toBe(1);
      expect(Array.isArray(doc.elements)).toBe(true);
    }
  });

  it("docCaption de full.json retorna o texto", () => {
    expect(docCaption(readFixture("full.json"))).toContain("Olá mundo");
  });
});

describe("defaults de criação (batem com os defaults de desserialização do Python)", () => {
  it("sticker w = 0.2", () => {
    expect(newStickerElement("😀").w).toBe(0.2);
  });

  it("texto w = 0.8 e size_factor = 0.07", () => {
    const t = newTextElement();
    expect(t.w).toBe(0.8);
    expect(t.size_factor).toBe(0.07);
  });
});

describe("targetFromAspect", () => {
  it("mapeia aspecto -> target", () => {
    expect(targetFromAspect("4:5")).toBe("feed_45");
    expect(targetFromAspect("1:1")).toBe("feed_11");
    expect(targetFromAspect(null)).toBe("story");
    expect(targetFromAspect("9:16")).toBe("story");
  });
});
