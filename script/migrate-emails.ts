import "dotenv/config";
import { db } from "../server/db";
import { users } from "../shared/schema";
import { encryptEmail, hashEmail } from "../server/utils/crypto";
import { eq } from "drizzle-orm";

async function migrateEmails() {
  console.log("🔄 Начинаем миграцию email...\n");

  // Получаем всех пользователей
  const allUsers = await db.select().from(users);
  
  console.log(`Найдено ${allUsers.length} пользователей\n`);

  for (const user of allUsers) {
    // Проверяем, зашифрован ли уже email (зашифрованный будет hex-строкой)
    const isAlreadyEncrypted = /^[0-9a-f]+$/i.test(user.email) && user.email.length > 50;
    
    if (isAlreadyEncrypted && user.emailHash) {
      console.log(`⏭️  ${user.id} — уже зашифрован, пропускаем`);
      continue;
    }

    const originalEmail = user.email;
    const emailEncrypted = encryptEmail(originalEmail);
    const emailHashValue = hashEmail(originalEmail);

    await db.update(users)
      .set({
        email: emailEncrypted,
        emailHash: emailHashValue,
      })
      .where(eq(users.id, user.id));

    console.log(`✅ ${user.id}`);
    console.log(`   Email: ${originalEmail}`);
    console.log(`   Encrypted: ${emailEncrypted.substring(0, 30)}...`);
    console.log(`   Hash: ${emailHashValue}\n`);
  }

  console.log("✅ Миграция завершена!");
  process.exit(0);
}

migrateEmails().catch((error) => {
  console.error("❌ Ошибка миграции:", error);
  process.exit(1);
});