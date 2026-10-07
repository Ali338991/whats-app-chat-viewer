// Prisma 7 configuration (datasource URL lives here, not in schema.prisma).
// Prisma 7 does not auto-load .env files, so load them here for local CLI use.
// On Vercel the variables come from the project settings instead.
import { defineConfig } from "prisma/config";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file); // never overrides variables that are already set
  } catch {
    /* file missing — fine */
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
