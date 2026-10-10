/**
 * Prisma client singleton.
 *
 * Prisma 7 talks to Postgres through a driver adapter (`pg`) instead of the Rust query engine.
 * The CLI side (migrations, studio) reads DATABASE_URL via prisma.config.ts; this is the runtime side.
 * In development the client is cached on globalThis so Next.js hot reloads do not open a new pool each time.
 */
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@/lib/generated/prisma/client"

const globalForPrisma = globalThis as unknown as {
  __forgePrisma?: PrismaClient
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres database."
    )
  }
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

export const prisma: PrismaClient =
  globalForPrisma.__forgePrisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production")
  globalForPrisma.__forgePrisma = prisma
