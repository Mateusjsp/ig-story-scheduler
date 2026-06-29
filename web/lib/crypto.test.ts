import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "./crypto";

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = "test-enc-key-123";
});

describe("crypto", () => {
  it("round-trips", () => {
    const t = "IGAA_exemplo_123";
    expect(decryptToken(encryptToken(t))).toBe(t);
  });
});
