import type { NextConfig } from "next";
import { readFileSync } from "fs";
import path from "node:path";

const isWindows = process.platform === "win32";
const forceStandalone = process.env.NEXT_STANDALONE === "true";
const disableStandalone = process.env.NEXT_STANDALONE === "false";
const projectRoot = path.resolve(".");

// Read version from package.json at build time
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const nextConfig: NextConfig = {
  // Disable x-powered-by header for security
  poweredByHeader: false,
  // VSCode/SSH port forwarding usually proxies through 127.0.0.1.
  // Explicitly allow these origins in dev to avoid cross-origin warnings.
  allowedDevOrigins: [
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://localhost:3000",
    "http://localhost:3001",
  ],
  // Keep heavy Node-only packages out of webpack server bundling in dev.
  // This avoids BullMQ's dynamic require warning and significantly reduces
  // memory pressure while compiling API routes.
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
    "better-sqlite3",
  ],
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
  // Avoid Windows traced-file copy warnings by default.
  ...(forceStandalone || (!isWindows && !disableStandalone)
    ? { output: "standalone" as const }
    : {}),
  // Inject build-time environment variables
  env: {
    APP_VERSION: pkg.version,
  },
};

export default nextConfig;
