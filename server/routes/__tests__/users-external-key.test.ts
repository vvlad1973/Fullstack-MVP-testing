/**
 * @module server/routes/__tests__/users-external-key
 * @description PRD-54 раздел 5.4: приведение внешнего ключа пользователя к хранимому виду.
 */
import { describe, it, expect } from "vitest";
import { normalizeExternalKey } from "../users";

describe("normalizeExternalKey", () => {
  it("обрезает пробелы, регистр сохраняет", () => {
    // Регистр остаётся: ключ показывают человеку в том виде, в каком он его ввёл.
    // Нечувствительность при СВЕРКЕ обеспечивают индекс по lower() и getUserByExternalKey.
    expect(normalizeExternalKey("  AB-12 ")).toBe("AB-12");
  });

  it("пустая строка — это отсутствие ключа, а не пустой ключ", () => {
    // Разница существенная: пустая строка совпала бы с любой другой пустой и связала бы
    // всех безымянных участников с одним пользователем.
    expect(normalizeExternalKey("   ")).toBeNull();
    expect(normalizeExternalKey("")).toBeNull();
    expect(normalizeExternalKey(undefined)).toBeNull();
    expect(normalizeExternalKey(null)).toBeNull();
  });

  it("не строку приводит к строке", () => {
    expect(normalizeExternalKey(12345)).toBe("12345");
  });
});
