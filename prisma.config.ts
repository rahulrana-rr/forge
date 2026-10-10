import "dotenv/config"
import { defineConfig, env } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Migrations need a direct connection: Neon (via Vercel) provides DATABASE_URL_UNPOOLED next to
  // the pooled DATABASE_URL the app uses at runtime. Locally only DATABASE_URL exists.
  datasource: { url: process.env.DATABASE_URL_UNPOOLED || env("DATABASE_URL") },
})
