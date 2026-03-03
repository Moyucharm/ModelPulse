import { createHash } from "node:crypto";
import { EndpointType } from "@/generated/prisma";
import type { DetectionJobData, EndpointDetection } from "./types";

const DETECT_PROMPT = process.env.DETECT_PROMPT || "1+1=2? yes or no";
const CLAUDE_PROFILE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Claude Code gateways (e.g. AnyRouter Claude Code relays) may validate requests more strictly than
// generic Anthropic-compatible proxies. This profile tries to match common Claude Code headers and
// includes the canonical first system block used by Claude Code.
const CLAUDE_CODE_SYSTEM_MARKER =
  process.env.CLAUDE_CODE_PROBE_SYSTEM_MARKER?.trim() ||
  "You are Claude Code, Anthropic's official CLI for Claude.";
// A second system block is commonly present in Claude Code requests. Some strict relays validate
// the "2-block" shape (marker + general instructions) rather than just the marker string.
const CLAUDE_CODE_SYSTEM_FOLLOWUP =
  process.env.CLAUDE_CODE_PROBE_SYSTEM_FOLLOWUP?.trim() ||
  "You are an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.";

// Claude Code commonly prepends internal reminders as separate user content blocks.
// Some strict relays validate the presence/shape of these blocks.
const CLAUDE_CODE_SYSTEM_REMINDER_TODO_EMPTY = `<system-reminder>
This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.
</system-reminder>`;

const CLAUDE_CODE_SYSTEM_REMINDER_INSTRUCTION_REMINDERS = `<system-reminder>
As you answer the user's questions, you can use the following context:
# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>`;

const CLAUDE_CODE_USER_ID =
  "user_model-check_account__session_00000000-0000-0000-0000-000000000000";

// AnyRouter-style Claude Code relays have been observed to accept older claude-cli request shapes
// more reliably than the newest SDK-flavored ones. We default to this "legacy" header set for
// probes, while still allowing custom overrides via CLAUDE_PROBE_CUSTOM_PROFILE_JSON.
const DEFAULT_CLAUDE_CODE_USER_AGENT = "claude-cli/2.0.31 (external, cli)";
const CLAUDE_CODE_USER_AGENT =
  process.env.CLAUDE_CODE_PROBE_USER_AGENT?.trim() || DEFAULT_CLAUDE_CODE_USER_AGENT;

const DEFAULT_CLAUDE_CODE_ANTHROPIC_BETA =
  "claude-code-20250219,fine-grained-tool-streaming-2025-05-14";
// If CLAUDE_CODE_PROBE_ANTHROPIC_BETA is set to an empty string, omit the header entirely.
const CLAUDE_CODE_ANTHROPIC_BETA = (() => {
  const raw = process.env.CLAUDE_CODE_PROBE_ANTHROPIC_BETA;
  if (raw === undefined) return DEFAULT_CLAUDE_CODE_ANTHROPIC_BETA;
  return raw.trim();
})();

// Claude Code always sends a toolset (file ops, bash, etc). Some strict relays validate
// that the request includes a non-empty tools array with expected tool names.
const CLAUDE_CODE_TOOL_STUBS: Record<string, unknown>[] = [
  {
    name: "Task",
    description: "Run a sub-task with a focused goal.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        subagent_type: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: true,
    },
  },
  {
    name: "Bash",
    description: "Execute a bash command in the user's environment.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "number" },
      },
      required: ["command"],
      additionalProperties: true,
    },
  },
  {
    name: "Glob",
    description: "List files matching a glob pattern.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
      },
      required: ["pattern"],
      additionalProperties: true,
    },
  },
  {
    name: "Grep",
    description: "Search for a pattern in files.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
      required: ["pattern"],
      additionalProperties: true,
    },
  },
  {
    name: "Read",
    description: "Read a file from the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: true,
    },
  },
  {
    name: "Edit",
    description: "Edit a file in the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
      additionalProperties: true,
    },
  },
  {
    name: "Write",
    description: "Write a file to the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: true,
    },
  },
  {
    name: "WebFetch",
    description: "Fetch a URL over HTTP.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
      additionalProperties: true,
    },
  },
  {
    name: "WebSearch",
    description: "Search the web for information.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      additionalProperties: true,
    },
  },
  {
    name: "TodoWrite",
    description: "Write the current todo list.",
    input_schema: {
      type: "object",
      properties: {
        items: { type: "array" },
      },
      required: ["items"],
      additionalProperties: true,
    },
  },
  {
    name: "NotebookEdit",
    description: "Edit a notebook file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: true,
    },
  },
  {
    name: "BashOutput",
    description: "Return stdout/stderr from a previously-run shell.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      additionalProperties: true,
    },
  },
  {
    name: "KillShell",
    description: "Terminate a running shell session.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      additionalProperties: true,
    },
  },
  {
    name: "AskUserQuestion",
    description: "Ask the user a clarifying question.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
      },
      required: ["question"],
      additionalProperties: true,
    },
  },
  {
    name: "Skill",
    description: "Execute a Claude Code skill command.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
      additionalProperties: true,
    },
  },
  {
    name: "SlashCommand",
    description: "Execute a slash command.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
      },
      required: ["command"],
      additionalProperties: true,
    },
  },
  {
    name: "EnterPlanMode",
    description: "Enter plan mode.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  },
  {
    name: "ExitPlanMode",
    description: "Exit plan mode.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  },
];

export type ClaudeProfileId =
  | "custom_profile"
  | "claude_code_blocks_stream"
  | "claude_code_legacy_stream"
  | "claude_code_blocks_nostream"
  | "claude_code_legacy_nostream"
  | "claude_code_bearer_blocks_stream"
  | "claude_code_bearer_blocks_nostream"
  | "anthropic_blocks_nostream"
  | "anthropic_legacy_nostream"
  | "anthropic_legacy_stream"
  | "bearer_blocks_nostream";

export interface ClaudeProfileEndpoint extends EndpointDetection {
  profileId: ClaudeProfileId;
}

interface ClaudeProfileCacheEntry {
  profileId: ClaudeProfileId;
  expiresAt: number;
}

interface ClaudeCustomProfile {
  headers: Record<string, string>;
  bodyPatch: Record<string, unknown>;
}

const claudeProfileCache = new Map<string, ClaudeProfileCacheEntry>();
let parsedCustomProfile: ClaudeCustomProfile | null | undefined;

function normalizeBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1")) {
    normalized = normalized.slice(0, -3);
  }
  return normalized;
}

function buildBaseHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
}

function buildBearerHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "anthropic-version": "2023-06-01",
  };
}

function buildDualAuthHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    // Claude Code may send the same auth value as both X-Api-Key and Authorization: Bearer.
    // Some relays validate that both are present.
    "X-Api-Key": apiKey,
    Authorization: `Bearer ${apiKey}`,
    "anthropic-version": "2023-06-01",
  };
}

function buildClaudeCodeHeaders(
  base: Record<string, string>,
  options: { stream: boolean }
): Record<string, string> {
  const headers: Record<string, string> = {
    ...base,
    // Common Claude Code headers (some relays validate these).
    Accept: options.stream ? "text/event-stream" : "application/json",
    "User-Agent": CLAUDE_CODE_USER_AGENT,
    // Claude Code sets this when it may use web tooling; some relays validate its presence.
    "anthropic-dangerous-direct-browser-access": "true",
    "x-app": "cli",
  };

  if (CLAUDE_CODE_ANTHROPIC_BETA) {
    headers["anthropic-beta"] = CLAUDE_CODE_ANTHROPIC_BETA;
  }

  return headers;
}

function buildBlocksBody(modelName: string, stream: boolean): Record<string, unknown> {
  return {
    model: modelName,
    max_tokens: 50,
    stream,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: DETECT_PROMPT,
          },
        ],
      },
    ],
  };
}

function buildClaudeCodeMessages(): Record<string, unknown>[] {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: CLAUDE_CODE_SYSTEM_REMINDER_TODO_EMPTY },
        { type: "text", text: CLAUDE_CODE_SYSTEM_REMINDER_INSTRUCTION_REMINDERS },
        { type: "text", text: DETECT_PROMPT },
      ],
    },
  ];
}

function buildClaudeCodeBody(modelName: string, stream: boolean): Record<string, unknown> {
  return {
    ...buildBlocksBody(modelName, stream),
    // Claude Code commonly uses temperature 0 for deterministic behavior.
    temperature: 0,
    // Use a more "CLI-like" token budget; small budgets sometimes get flagged by strict relays.
    max_tokens: 256,
    messages: buildClaudeCodeMessages(),
    system: [
      {
        type: "text",
        text: CLAUDE_CODE_SYSTEM_MARKER,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: CLAUDE_CODE_SYSTEM_FOLLOWUP,
        cache_control: { type: "ephemeral" },
      },
    ],
    metadata: {
      // Claude Code uses a structured user_id; relays often only require that it exists.
      user_id: CLAUDE_CODE_USER_ID,
    },
    // Some relays expect the Claude Code request shape to always include tools fields (even if empty).
    tools: CLAUDE_CODE_TOOL_STUBS,
    tool_choice: { type: "auto" },
  };
}

function buildClaudeCodeBodyNoType(modelName: string, stream: boolean): Record<string, unknown> {
  return {
    ...buildBlocksBody(modelName, stream),
    temperature: 0,
    max_tokens: 256,
    messages: buildClaudeCodeMessages(),
    // Some clients/relays omit the system block "type" field (implicitly text).
    system: [
      {
        text: CLAUDE_CODE_SYSTEM_MARKER,
        cache_control: { type: "ephemeral" },
      },
      {
        text: CLAUDE_CODE_SYSTEM_FOLLOWUP,
        cache_control: { type: "ephemeral" },
      },
    ],
    metadata: {
      user_id: CLAUDE_CODE_USER_ID,
    },
    tools: CLAUDE_CODE_TOOL_STUBS,
    tool_choice: { type: "auto" },
  };
}

function buildClaudeCodeLegacyBody(modelName: string, stream: boolean): Record<string, unknown> {
  return {
    ...buildLegacyBody(modelName, stream),
    temperature: 0,
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `${CLAUDE_CODE_SYSTEM_REMINDER_TODO_EMPTY}\n\n${CLAUDE_CODE_SYSTEM_REMINDER_INSTRUCTION_REMINDERS}\n\n${DETECT_PROMPT}`,
      },
    ],
    system: [
      {
        type: "text",
        text: CLAUDE_CODE_SYSTEM_MARKER,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: CLAUDE_CODE_SYSTEM_FOLLOWUP,
        cache_control: { type: "ephemeral" },
      },
    ],
    metadata: {
      user_id: CLAUDE_CODE_USER_ID,
    },
    tools: CLAUDE_CODE_TOOL_STUBS,
    tool_choice: { type: "auto" },
  };
}

function buildLegacyBody(modelName: string, stream: boolean): Record<string, unknown> {
  return {
    model: modelName,
    max_tokens: 50,
    stream,
    messages: [
      {
        role: "user",
        content: DETECT_PROMPT,
      },
    ],
  };
}

function readObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function deepMergeObject(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = readObject(merged[key]);
      merged[key] = deepMergeObject(existing, value as Record<string, unknown>);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function parseCustomProfileFromEnv(): ClaudeCustomProfile | null {
  if (parsedCustomProfile !== undefined) {
    return parsedCustomProfile;
  }

  const raw = process.env.CLAUDE_PROBE_CUSTOM_PROFILE_JSON?.trim();
  if (!raw) {
    parsedCustomProfile = null;
    return parsedCustomProfile;
  }

  try {
    const parsed = JSON.parse(raw) as {
      headers?: Record<string, unknown>;
      bodyPatch?: Record<string, unknown>;
    };

    const headers = Object.fromEntries(
      Object.entries(readObject(parsed.headers))
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, value as string])
    );

    const bodyPatch = readObject(parsed.bodyPatch);
    parsedCustomProfile = { headers, bodyPatch };
    return parsedCustomProfile;
  } catch (error) {
    console.warn(
      "[claude-profile] invalid CLAUDE_PROBE_CUSTOM_PROFILE_JSON:",
      error instanceof Error ? error.message : String(error)
    );
    parsedCustomProfile = null;
    return parsedCustomProfile;
  }
}

function buildProfileEndpoint(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  profileId: ClaudeProfileId
): ClaudeProfileEndpoint | null {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const url = `${normalizedBaseUrl}/v1/messages`;
  const betaUrl = `${url}?beta=true`;

  switch (profileId) {
    case "custom_profile": {
      const custom = parseCustomProfileFromEnv();
      if (!custom) return null;

      const headers = {
        ...buildBaseHeaders(apiKey),
        ...custom.headers,
      };
      const requestBody = deepMergeObject(
        buildBlocksBody(modelName, false),
        custom.bodyPatch
      );

      return {
        profileId,
        type: EndpointType.CLAUDE,
        url,
        headers,
        requestBody,
      };
    }
    case "claude_code_blocks_stream":
      return {
        profileId,
        type: EndpointType.CLAUDE,
        // Variant without `?beta=true` (some relays only accept beta flags via headers).
        url,
        headers: buildClaudeCodeHeaders(buildDualAuthHeaders(apiKey), { stream: true }),
        requestBody: buildClaudeCodeBody(modelName, true),
      };
    case "claude_code_legacy_stream":
      return {
        profileId,
        type: EndpointType.CLAUDE,
        url: betaUrl,
        headers: buildClaudeCodeHeaders(buildDualAuthHeaders(apiKey), { stream: true }),
        requestBody: buildClaudeCodeLegacyBody(modelName, true),
      };
    case "claude_code_blocks_nostream":
      return {
        profileId,
        type: EndpointType.CLAUDE,
        url,
        headers: buildClaudeCodeHeaders(buildDualAuthHeaders(apiKey), { stream: false }),
        requestBody: buildClaudeCodeBody(modelName, false),
      };
    case "claude_code_legacy_nostream":
      return {
        profileId,
        type: EndpointType.CLAUDE,
        url: betaUrl,
        headers: buildClaudeCodeHeaders(buildDualAuthHeaders(apiKey), { stream: false }),
        requestBody: buildClaudeCodeLegacyBody(modelName, false),
      };
    case "claude_code_bearer_blocks_stream":
      return {
        profileId,
        type: EndpointType.CLAUDE,
        url: betaUrl,
        headers: buildClaudeCodeHeaders(buildBearerHeaders(apiKey), { stream: true }),
        requestBody: buildClaudeCodeBody(modelName, true),
      };
    case "claude_code_bearer_blocks_nostream":
      return {
        profileId,
        type: EndpointType.CLAUDE,
        url: betaUrl,
        headers: buildClaudeCodeHeaders(buildBearerHeaders(apiKey), { stream: false }),
        requestBody: buildClaudeCodeBody(modelName, false),
      };
    case "anthropic_blocks_nostream":
      return {
        profileId,
        type: EndpointType.CLAUDE,
        url,
        headers: buildBaseHeaders(apiKey),
        requestBody: buildBlocksBody(modelName, false),
      };
    case "anthropic_legacy_nostream":
      return {
        profileId,
        type: EndpointType.CLAUDE,
        url,
        headers: buildBaseHeaders(apiKey),
        requestBody: buildLegacyBody(modelName, false),
      };
    case "anthropic_legacy_stream":
      return {
        profileId,
        type: EndpointType.CLAUDE,
        url,
        headers: buildBaseHeaders(apiKey),
        requestBody: buildLegacyBody(modelName, true),
      };
    case "bearer_blocks_nostream":
      return {
        profileId,
        type: EndpointType.CLAUDE,
        url,
        headers: buildBearerHeaders(apiKey),
        requestBody: buildBlocksBody(modelName, false),
      };
    default:
      return null;
  }
}

export function getOrderedClaudeProfileEndpoints(
  baseUrl: string,
  apiKey: string,
  modelName: string
): ClaudeProfileEndpoint[] {
  const orderedProfileIds: ClaudeProfileId[] = [
    "custom_profile",
    "claude_code_bearer_blocks_stream",
    "claude_code_blocks_stream",
    "claude_code_legacy_stream",
    "claude_code_blocks_nostream",
    "claude_code_legacy_nostream",
    "claude_code_bearer_blocks_nostream",
    "anthropic_blocks_nostream",
    "anthropic_legacy_nostream",
    "anthropic_legacy_stream",
    "bearer_blocks_nostream",
  ];

  return orderedProfileIds
    .map((profileId) => buildProfileEndpoint(baseUrl, apiKey, modelName, profileId))
    .filter((profile): profile is ClaudeProfileEndpoint => profile !== null);
}

export function getClaudeProfileEndpointById(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  profileId: ClaudeProfileId
): ClaudeProfileEndpoint | null {
  return buildProfileEndpoint(baseUrl, apiKey, modelName, profileId);
}

function getClaudeCacheKey(job: Pick<DetectionJobData, "channelId" | "modelName" | "apiKey">): string {
  const keyHash = createHash("sha256").update(job.apiKey).digest("hex").slice(0, 16);
  return `${job.channelId}|${job.modelName}|${keyHash}`;
}

export function getCachedClaudeProfileId(
  job: Pick<DetectionJobData, "channelId" | "modelName" | "apiKey">
): ClaudeProfileId | null {
  const cacheKey = getClaudeCacheKey(job);
  const cached = claudeProfileCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    claudeProfileCache.delete(cacheKey);
    return null;
  }
  return cached.profileId;
}

export function setCachedClaudeProfileId(
  job: Pick<DetectionJobData, "channelId" | "modelName" | "apiKey">,
  profileId: ClaudeProfileId
): void {
  claudeProfileCache.set(getClaudeCacheKey(job), {
    profileId,
    expiresAt: Date.now() + CLAUDE_PROFILE_CACHE_TTL_MS,
  });
}

export function clearCachedClaudeProfileId(
  job: Pick<DetectionJobData, "channelId" | "modelName" | "apiKey">
): void {
  claudeProfileCache.delete(getClaudeCacheKey(job));
}

export function isClaudeProbeDebugEnabled(): boolean {
  return process.env.CLAUDE_PROBE_DEBUG === "true";
}

export function clearClaudeProfileCacheForTests(): void {
  claudeProfileCache.clear();
  parsedCustomProfile = undefined;
}
