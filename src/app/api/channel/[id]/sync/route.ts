// Channel models API - Sync models from /v1/models endpoint

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { syncChannelModels } from "@/lib/queue/service";

type SelectedModelPair = {
  modelName: string;
  keyId: string | null;
};

type SelectedModelCliConfig = Record<
  string,
  { chat: boolean; gemini: boolean; codex: boolean; claude: boolean }
>;

const SYNC_TIMEOUT_MS = 120_000;

function normalizeCliFlag(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

function normalizeSelectedModelCliConfig(input: unknown): SelectedModelCliConfig | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const normalized: SelectedModelCliConfig = {};
  for (const [rawModelName, rawConfig] of Object.entries(input as Record<string, unknown>)) {
    const modelName = rawModelName.trim();
    if (!modelName) continue;

    const config = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? (rawConfig as Record<string, unknown>)
      : {};

    normalized[modelName] = {
      chat: normalizeCliFlag(config.chat),
      gemini: normalizeCliFlag(config.gemini),
      codex: normalizeCliFlag(config.codex),
      claude: normalizeCliFlag(config.claude),
    };
  }

  return normalized;
}

// POST /api/channel/[id]/sync - Sync models from channel
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    // Parse optional selectedModels from body
    let selectedModels: string[] | undefined;
    let selectedModelPairs: SelectedModelPair[] | undefined;
    let selectedModelCliConfig: SelectedModelCliConfig | undefined;
    try {
      const body = await request.json();
      if (Array.isArray(body.selectedModels)) {
        selectedModels = body.selectedModels;
      }
      if (Array.isArray(body.selectedModelPairs)) {
        selectedModelPairs = body.selectedModelPairs
          .filter(
            (item: unknown): item is { modelName: unknown; keyId?: unknown } =>
              typeof item === "object" && item !== null && "modelName" in item
          )
          .map((item: { modelName: unknown; keyId?: unknown }) => ({
            modelName: typeof item.modelName === "string" ? item.modelName : "",
            keyId: typeof item.keyId === "string" ? item.keyId : null,
          }))
          .filter((item: { modelName: string; keyId: string | null }) => item.modelName.trim().length > 0);
      }
      selectedModelCliConfig = normalizeSelectedModelCliConfig(body.selectedModelCliConfig);
      console.log(
        `[sync] channel=${id} selectedModels=${selectedModels?.length ?? "undefined"} selectedModelPairs=${selectedModelPairs?.length ?? "undefined"} selectedModelCliConfig=${selectedModelCliConfig ? Object.keys(selectedModelCliConfig).length : "undefined"}`
      );
    } catch {
      // No body or invalid JSON, use default behavior (fetch from API)
      console.log(`[sync] channel=${id} body parse failed, falling back to API fetch`);
    }

    const result = await Promise.race([
      syncChannelModels(
        id,
        selectedModels,
        selectedModelPairs,
        selectedModelCliConfig
      ),
      new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`同步超时（>${Math.round(SYNC_TIMEOUT_MS / 1000)}秒）`));
        }, SYNC_TIMEOUT_MS);
        // Avoid keeping the event loop alive only for this timeout.
        timeoutId.unref?.();
      }),
    ]);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync models";
    console.error(`[sync] channel=${(await params).id} error:`, message);
    return NextResponse.json(
      { error: message, code: "SYNC_ERROR" },
      { status: 500 }
    );
  }
}
