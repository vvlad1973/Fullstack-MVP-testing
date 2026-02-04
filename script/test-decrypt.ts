import "dotenv/config";
import { decryptEmail } from "../server/utils/crypto";

// Данные из базы
const encryptedEmails = [
  "be0a3d293fe1c5d82c9192",      // admin@rt.ru
  "b30b31323fc4c5ec768694866afbf1dc",  // learner@test.com
  "a51b322b3ed799c97484829c2de1dec38301a815",  // zubkov.evgeniy@rt.ru
];

for (const encrypted of encryptedEmails) {
  console.log("Encrypted:", encrypted);
  const decrypted = decryptEmail(encrypted);
  console.log("Decrypted:", decrypted);
  console.log("Decrypted (hex):", Buffer.from(decrypted).toString("hex"));
  console.log("---");
}