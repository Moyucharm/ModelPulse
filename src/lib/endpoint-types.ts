export const CHANNEL_ENDPOINT_TYPES = [
  "CHAT",
  "CODEX",
  "CLAUDE",
  "GEMINI",
  "IMAGE",
] as const;

export type ChannelEndpointType = (typeof CHANNEL_ENDPOINT_TYPES)[number];

export const DEFAULT_CHANNEL_ENDPOINT_TYPES: ChannelEndpointType[] = ["CHAT"];

export const EMPTY_CHANNEL_ENDPOINT_TYPES: ChannelEndpointType[] = [];

const CHANNEL_ENDPOINT_TYPE_SET = new Set<string>(CHANNEL_ENDPOINT_TYPES);

const ENDPOINT_TYPE_ALIASES: Record<string, ChannelEndpointType> = {
  chat: "CHAT",
  "chat completions": "CHAT",
  chatcompletions: "CHAT",
  completions: "CHAT",
  "openai chat": "CHAT",
  "openai chat completions": "CHAT",
  responses: "CODEX",
  response: "CODEX",
  codex: "CODEX",
  "responses api": "CODEX",
  "openai responses api": "CODEX",
  messages: "CLAUDE",
  message: "CLAUDE",
  claude: "CLAUDE",
  anthropic: "CLAUDE",
  "anthropic messages": "CLAUDE",
  "anthropic messages api": "CLAUDE",
  gemini: "GEMINI",
  generatecontent: "GEMINI",
  "generate content": "GEMINI",
  "gemini generatecontent": "GEMINI",
  image: "IMAGE",
  images: "IMAGE",
  "images api": "IMAGE",
  "openai images": "IMAGE",
  "openai images api": "IMAGE",
};

function normalizeAliasKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isChannelEndpointType(value: unknown): value is ChannelEndpointType {
  return typeof value === "string" && CHANNEL_ENDPOINT_TYPE_SET.has(value);
}

export function normalizeChannelEndpointType(value: unknown): ChannelEndpointType | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const upper = trimmed.toUpperCase();
  if (CHANNEL_ENDPOINT_TYPE_SET.has(upper)) {
    return upper as ChannelEndpointType;
  }

  const aliasKey = normalizeAliasKey(trimmed);
  const directAlias = ENDPOINT_TYPE_ALIASES[aliasKey];
  if (directAlias) {
    return directAlias;
  }

  const compactAlias = aliasKey.replace(/\s+/g, "");
  return ENDPOINT_TYPE_ALIASES[compactAlias] ?? null;
}

export function normalizeChannelEndpointTypes(
  value: unknown,
  fallback: readonly ChannelEndpointType[] = DEFAULT_CHANNEL_ENDPOINT_TYPES
): ChannelEndpointType[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : [];

  const deduped = new Set<ChannelEndpointType>();
  for (const item of items) {
    const normalized = normalizeChannelEndpointType(item);
    if (normalized) {
      deduped.add(normalized);
    }
  }

  if (deduped.size > 0) {
    return CHANNEL_ENDPOINT_TYPES.filter((type) => deduped.has(type));
  }

  return [...fallback];
}

export function hasSameChannelEndpointTypes(
  left: readonly ChannelEndpointType[],
  right: readonly ChannelEndpointType[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((type, index) => type === right[index]);
}

export function endpointTypeLabel(
  type: ChannelEndpointType,
  variant: "full" | "compact" = "full"
): string {
  switch (type) {
    case "CHAT":
      return variant === "compact" ? "OpenAI Chat" : "OpenAI Chat Completions";
    case "CODEX":
      return variant === "compact" ? "OpenAI Responses" : "OpenAI Responses API";
    case "CLAUDE":
      return variant === "compact" ? "Anthropic Messages" : "Anthropic Messages API";
    case "GEMINI":
      return variant === "compact" ? "Gemini Content" : "Gemini generateContent";
    case "IMAGE":
      return variant === "compact" ? "OpenAI Images" : "OpenAI Images API";
    default:
      return type;
  }
}

export function endpointTypePath(type: ChannelEndpointType): string {
  switch (type) {
    case "CHAT":
      return "/v1/chat/completions";
    case "CODEX":
      return "/v1/responses";
    case "CLAUDE":
      return "/v1/messages";
    case "GEMINI":
      return "/v1beta/models/{model}:generateContent";
    case "IMAGE":
      return "/v1/images/generations";
    default:
      return "";
  }
}

export const CHANNEL_ENDPOINT_OPTIONS = CHANNEL_ENDPOINT_TYPES.map((type) => ({
  type,
  label: endpointTypeLabel(type),
  compactLabel: endpointTypeLabel(type, "compact"),
  path: endpointTypePath(type),
  provider:
    type === "CLAUDE"
      ? "Anthropic"
      : type === "GEMINI"
        ? "Google"
        : "OpenAI",
  description:
    type === "CHAT"
      ? "兼容大多数 OpenAI 风格聊天接口，适合常规文本模型。"
      : type === "CODEX"
        ? "用于 Responses 风格接口，适合需要 /v1/responses 的渠道。"
        : type === "CLAUDE"
          ? "直接按 Anthropic Messages 协议发请求，不再使用 CLI 概念。"
          : type === "GEMINI"
            ? "按 Gemini generateContent 协议测试，适合对应网关。"
            : "用于图片生成接口，按 OpenAI Images API 进行测试。",
}));
