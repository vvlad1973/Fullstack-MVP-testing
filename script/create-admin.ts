import "dotenv/config";
import { db } from "../server/db";
import { users } from "../shared/schema";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { encryptEmail, hashEmail } from "../server/utils/crypto";

async function createUsers() {
  const usersToCreate = [
    { email: "admin@rt.ru", password: "admin123", name: "Администратор", role: "author" as const },
    { email: "learner@test.com", password: "learner123", name: "Тестовый ученик", role: "learner" as const },
    { email: "zubkov.evgeniy@rt.ru", password: "learner123", name: "Ирина Зубкова", role: "learner" as const },
  ];

  for (const userData of usersToCreate) {
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(userData.password, 10);
    const emailEncrypted = encryptEmail(userData.email);
    const emailHashValue = hashEmail(userData.email);

    try {
      await db.insert(users).values({
        id,
        email: emailEncrypted,
        emailHash: emailHashValue,
        passwordHash,
        name: userData.name,
        role: userData.role,
        status: "active",
        mustChangePassword: false,
        gdprConsent: true,
        gdprConsentAt: new Date(),
        createdAt: new Date(),
      });

      console.log(`✅ Created: ${userData.email}`);
      console.log(`   Encrypted: ${emailEncrypted}`);
      console.log(`   Hash: ${emailHashValue}\n`);
    } catch (error) {
      console.error(`❌ Error creating ${userData.email}:`, error);
    }
  }

  console.log("Done!");
  process.exit(0);
}

createUsers();