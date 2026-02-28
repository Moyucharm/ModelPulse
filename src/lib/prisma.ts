import { PrismaClient } from "@/generated/prisma";
import type { SqlDriverAdapterFactory } from "@prisma/driver-adapter-utils";
import * as BetterSqliteAdapter from "@prisma/adapter-better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encryptApiKey, decryptApiKey } from "@/lib/crypto";

// ---------------------------------------------------------------------------
// SQLite adapter setup
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as {
  basePrisma: PrismaClient | undefined;
};

type BetterSqliteCtor = new (
  options: { url: string },
  config?: { timestampFormat?: "iso8601" | "unixepoch-ms" }
) => SqlDriverAdapterFactory;

const adapterCtorCandidate =
  (BetterSqliteAdapter as Record<string, unknown>).PrismaBetterSqlite3 ??
  (BetterSqliteAdapter as Record<string, unknown>).PrismaBetterSQLite3;

if (typeof adapterCtorCandidate !== "function") {
  throw new Error(
    "Failed to load SQLite Prisma adapter from @prisma/adapter-better-sqlite3."
  );
}

const sqliteUrl = process.env.DATABASE_URL || "file:./data/model-check.db";

function ensureSqliteDirectory(databaseUrl: string): void {
  if (!databaseUrl.startsWith("file:")) {
    return;
  }

  let dbFilePath = "";

  if (databaseUrl.startsWith("file://")) {
    try {
      dbFilePath = fileURLToPath(new URL(databaseUrl));
    } catch {
      dbFilePath = "";
    }
  }

  if (!dbFilePath) {
    const rawPath = databaseUrl.slice("file:".length).split(/[?#]/, 1)[0] || "";
    if (!rawPath || rawPath === ":memory:") {
      return;
    }
    dbFilePath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(process.cwd(), rawPath);
  }

  const dbDir = path.dirname(dbFilePath);
  if (dbDir && dbDir !== ".") {
    mkdirSync(dbDir, { recursive: true });
  }
}

ensureSqliteDirectory(sqliteUrl);

const sqliteAdapter = new (adapterCtorCandidate as BetterSqliteCtor)(
  { url: sqliteUrl },
  { timestampFormat: "iso8601" }
);

function createBasePrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: sqliteAdapter,
    log: ["error", "warn"],
  });
}

// ---------------------------------------------------------------------------
// Transparent API key encryption via Prisma client extension
// ---------------------------------------------------------------------------

const WRITE_OPS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
]);

const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "create",
  "createManyAndReturn",
  "update",
  "upsert",
  "delete",
]);

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Encrypt `apiKey` inside write-operation args before they reach the DB. */
function encryptArgs(args: any, operation: string): void {
  if (!WRITE_OPS.has(operation)) return;

  // data field (create / update / createMany / updateMany)
  if (args.data != null) {
    if (Array.isArray(args.data)) {
      for (const item of args.data) {
        if (typeof item.apiKey === "string") {
          item.apiKey = encryptApiKey(item.apiKey);
        }
      }
    } else if (typeof args.data.apiKey === "string") {
      args.data.apiKey = encryptApiKey(args.data.apiKey);
    }
  }

  // upsert has separate create / update payloads
  if (operation === "upsert") {
    if (typeof args.create?.apiKey === "string") {
      args.create.apiKey = encryptApiKey(args.create.apiKey);
    }
    if (typeof args.update?.apiKey === "string") {
      args.update.apiKey = encryptApiKey(args.update.apiKey);
    }
  }
}

/** Recursively decrypt `apiKey` (and nested `channelKeys[].apiKey`) in query results. */
function decryptResult(result: any, decryptNestedKeys: boolean): any {
  if (result == null) return result;

  if (Array.isArray(result)) {
    return result.map((r) => decryptResult(r, decryptNestedKeys));
  }

  if (typeof result !== "object") return result;

  // Only touch objects that look like DB rows (have apiKey or channelKeys)
  let patched = result;

  if ("apiKey" in patched && typeof patched.apiKey === "string") {
    patched = { ...patched, apiKey: decryptApiKey(patched.apiKey) };
  }

  if (
    decryptNestedKeys &&
    "channelKeys" in patched &&
    Array.isArray(patched.channelKeys)
  ) {
    patched = {
      ...patched,
      channelKeys: patched.channelKeys.map((ck: any) =>
        typeof ck?.apiKey === "string"
          ? { ...ck, apiKey: decryptApiKey(ck.apiKey) }
          : ck
      ),
    };
  }

  return patched;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Build extended client
// ---------------------------------------------------------------------------

function createExtendedClient() {
  const base = globalForPrisma.basePrisma ?? createBasePrismaClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.basePrisma = base;

  return base.$extends({
    query: {
      channel: {
        async $allOperations({ operation, args, query }) {
          encryptArgs(args, operation);
          const result = await query(args);
          if (READ_OPS.has(operation)) {
            return decryptResult(result, /* decryptNestedKeys */ true);
          }
          return result;
        },
      },
      channelKey: {
        async $allOperations({ operation, args, query }) {
          encryptArgs(args, operation);
          const result = await query(args);
          if (READ_OPS.has(operation)) {
            return decryptResult(result, /* decryptNestedKeys */ false);
          }
          return result;
        },
      },
    },
  });
}

export const prisma = createExtendedClient();

export default prisma;
