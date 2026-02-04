import Crypto from "@vvlad1973/crypto";
import { createHash } from "crypto";

// Секретный ключ для шифрования (из переменных окружения)
const ENCRYPTION_PASSWORD = process.env.ENCRYPTION_PASSWORD || "default-encryption-key-change-me";
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT || "default-salt-change-me";

// Фиксированный IV (генерируем из пароля и соли для воспроизводимости)
const IV_SEED = createHash("sha256")
  .update(ENCRYPTION_PASSWORD + ENCRYPTION_SALT)
  .digest()
  .slice(0, 16); // 16 байт для AES

// Создаём единственный экземпляр с фиксированным IV
const cryptoInstance = new Crypto({
  password: ENCRYPTION_PASSWORD,
  salt: ENCRYPTION_SALT,
  algorithm: "SHA512",
  iterations: 10000,
  keyLength: 32,
  iv: IV_SEED, // Фиксированный IV
});

/**
 * Шифрует email для хранения в базе
 */
export function encryptEmail(email: string): string {
  const normalizedEmail = email.toLowerCase().trim();
  return cryptoInstance.encrypt(normalizedEmail);
}

/**
 * Дешифрует email из базы
 */
export function decryptEmail(encryptedEmail: string): string {
  try {
    return cryptoInstance.decrypt(encryptedEmail);
  } catch (error) {
    console.error("Failed to decrypt email:", error);
    return "";
  }
}

/**
 * Создаёт хеш email для поиска в базе
 * Используем SHA-256 — быстрый и достаточный для поиска
 */
export function hashEmail(email: string): string {
  const normalizedEmail = email.toLowerCase().trim();
  return createHash("sha256").update(normalizedEmail).digest("hex");
}

/**
 * Проверяет соответствие email хешу
 */
export function verifyEmailHash(email: string, hash: string): boolean {
  return hashEmail(email) === hash;
}