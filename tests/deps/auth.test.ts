import { describe, expect, it } from "vitest";
import { decodeExpiry, tokenIsUsable } from "../../scripts/deps/repo-auth.mjs";

/** Minimal unsigned JWT with the given `exp`. */
function jwt(exp: number) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("decodeExpiry", () => {
  it("читает exp из полезной нагрузки", () => {
    expect(decodeExpiry(jwt(1789731223))).toBe(1789731223000);
  });

  it("возвращает null на непохожей строке", () => {
    expect(decodeExpiry("не токен")).toBeNull();
  });

  it("возвращает null, когда exp отсутствует", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "x" })).toString("base64url");
    expect(decodeExpiry(`h.${payload}.s`)).toBeNull();
  });
});

describe("tokenIsUsable", () => {
  it("годен, пока до конца больше запаса", () => {
    expect(tokenIsUsable(jwt(2000), 1000 * 1000, 30000)).toBe(true);
  });

  it("негоден, когда до конца меньше запаса", () => {
    expect(tokenIsUsable(jwt(2000), 1980 * 1000, 30000)).toBe(false);
  });

  it("негоден, когда срок не прочитан", () => {
    expect(tokenIsUsable("мусор", 0, 30000)).toBe(false);
  });

  it("негоден на самой границе запаса: 'больше запаса' исключает равенство", () => {
    // exp=2000s -> expiry=2_000_000ms; now=1_970_000ms; expiry-now === skewMs === 30_000.
    // Catches ">" silently weakened to ">=".
    expect(tokenIsUsable(jwt(2000), 1970 * 1000, 30000)).toBe(false);
  });

  it("уважает переданный skewMs, а не запасную константу по умолчанию", () => {
    // expiry-now = 40_000ms: usable under the default 30s reserve, unusable under a 50s one
    // passed explicitly. If the function silently substituted its own default, both calls
    // would agree instead of disagreeing.
    const now = 1960 * 1000; // exp=2000s -> expiry=2_000_000ms
    expect(tokenIsUsable(jwt(2000), now, 30000)).toBe(true);
    expect(tokenIsUsable(jwt(2000), now, 50000)).toBe(false);
  });
});
