import { defineConfig, env } from "prisma/config";
import { createRequire } from "node:module";

// `dotenv` is convenient in local/dev, but it is intentionally absent from the
// slim production image. Make it best-effort so Prisma CLI can still run.
try {
  const require = createRequire(import.meta.url);
  require("dotenv/config");
} catch {
  // ignore
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:./data/modelpulse.db";
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
