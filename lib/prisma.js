// Prisma Client singleton (Prisma 7 + PostgreSQL driver adapter).
// In development Next.js hot-reloads modules, so the instance is cached on
// globalThis to avoid opening a new connection pool on every reload.
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis;

// Lazily created so that importing this module never requires the env var
// at build time — only the first query does.
export function db() {
  if (!globalForPrisma.__keepsakePrisma) globalForPrisma.__keepsakePrisma = createClient();
  return globalForPrisma.__keepsakePrisma;
}

export const prisma = new Proxy(
  {},
  {
    get(_t, prop) {
      const client = db();
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);
