import "dotenv/config";
import { encryptEmail, decryptEmail, hashEmail } from "../server/utils/crypto";

const testEmail = "admin@rt.ru";

console.log("Original:", testEmail);

const encrypted = encryptEmail(testEmail);
console.log("Encrypted:", encrypted);

const decrypted = decryptEmail(encrypted);
console.log("Decrypted:", decrypted);

const hash = hashEmail(testEmail);
console.log("Hash:", hash);

console.log("\nTest passed:", decrypted === testEmail);