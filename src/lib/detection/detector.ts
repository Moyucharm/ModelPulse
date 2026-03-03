// Core detector - executes HTTP requests to test model availability

import { CheckStatus, EndpointType } from "@/generated/prisma";
import { buildEndpointDetection } from "./strategies";
import type { DetectionJobData, DetectionResult, EndpointDetection, FetchModelsResult } from "./types";
import { proxyFetch } from "@/lib/utils/proxy-fetch";
import { checkResponseBodyForError } from "./response-error";
import {
  clearCachedClaudeProfileId,
  getCachedClaudeProfileId,
  getClaudeProfileEndpointById,
  getOrderedClaudeProfileEndpoints,
  isClaudeProbeDebugEnabled,
  setCachedClaudeProfileId,
  type ClaudeProfileEndpoint,
} from "./claude-profile";

// Detection timeout in milliseconds
const DETECTION_TIMEOUT = 30000;

// Global proxy from environment
const GLOBAL_PROXY = process.env.GLOBAL_PROXY;

/**
 * Sleep utility for anti-blocking delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Random delay between min and max milliseconds
 */
export function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Strip <think>...</think> blocks from response content
 * Many relay/proxy services embed thinking content in the main response
 */
function stripThinkingBlocks(text: string): string {
  // Remove complete <think>...</think> blocks (including multiline)
  let stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // Remove unclosed <think> block (thinking was truncated)
  stripped = stripped.replace(/<think>[\s\S]*/gi, "").trim();
  // If stripping removed everything, return original (the model only returned thinking)
  return stripped || text;
}

/**
 * Extract text content from SSE stream based on endpoint type
 * Supports: OpenAI CHAT delta, Claude content_block_delta, Codex output_text.delta
 */
function extractStreamContent(sseText: string, endpointType: EndpointType): string | undefined {
  let content = "";
  for (const line of sseText.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const json = line.slice(6).trim();
    if (json === "[DONE]") break;
    try {
      const event = JSON.parse(json);

      switch (endpointType) {
        case "CHAT": {
          // OpenAI: {"choices":[{"delta":{"content":"token"}}]}
          const delta = event.choices?.[0]?.delta;
          if (typeof delta?.content === "string") {
            content += delta.content;
          }
          break;
        }
        case "CLAUDE": {
          // Anthropic: {"type":"content_block_delta","delta":{"type":"text_delta","text":"token"}}
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
            content += event.delta.text;
          }
          break;
        }
        case "CODEX": {
          // Responses API: {"type":"response.output_text.delta","delta":"token"}
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            content += event.delta;
          }
          if (event.type === "response.output_text.done" && typeof event.text === "string") {
            content = event.text;
          }
          break;
        }
      }
    } catch {
      // skip unparseable lines
    }
  }
  if (content.length > 0) {
    return stripThinkingBlocks(content).slice(0, 500);
  }
  return undefined;
}

/**
 * Parse the last meaningful JSON event from SSE stream for error checking
 */
function parseLastSSEEvent(sseText: string): unknown {
  const lines = sseText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("data: ")) continue;
    const json = lines[i].slice(6).trim();
    if (json === "[DONE]") continue;
    try {
      return JSON.parse(json);
    } catch {
      // skip
    }
  }
  return undefined;
}

/**
 * Extract response content from API response based on endpoint type
 */
function extractResponseContent(
  responseBody: unknown,
  endpointType: EndpointType
): string | undefined {
  try {
    const body = responseBody as Record<string, unknown>;

    switch (endpointType) {
      case "CHAT": {
        // OpenAI format: response.choices[0].message.content
        const choices = body.choices as {
          message?: {
            content?: string | null;
            reasoning_content?: string;
            refusal?: string;
          };
          delta?: { content?: string | null };
          text?: string;
        }[] | undefined;

        const msg = choices?.[0]?.message;
        if (msg) {
          // 1. Standard content field
          if (typeof msg.content === "string" && msg.content.length > 0) {
            return stripThinkingBlocks(msg.content).slice(0, 500);
          }
          // 2. Reasoning models (DeepSeek R1 etc.) put response in reasoning_content
          if (typeof msg.reasoning_content === "string" && msg.reasoning_content.length > 0) {
            return stripThinkingBlocks(msg.reasoning_content).slice(0, 500);
          }
          // 3. Refusal content
          if (typeof msg.refusal === "string" && msg.refusal.length > 0) {
            return msg.refusal.slice(0, 500);
          }
        }

        // 4. Streaming-style delta response
        const delta = choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          return stripThinkingBlocks(delta.content).slice(0, 500);
        }

        // 5. Legacy completions format
        const text = choices?.[0]?.text;
        if (typeof text === "string" && text.length > 0) {
          return stripThinkingBlocks(text).slice(0, 500);
        }

        break;
      }
      case "CLAUDE": {
        // Claude format: response.content[].text
        // Extended thinking models return: [{type: "thinking", thinking: "..."}, {type: "text", text: "..."}]
        // Normal models return: [{type: "text", text: "..."}]
        const content = body.content as { type?: string; text?: string }[] | undefined;
        if (Array.isArray(content)) {
          // Find the first text block (skip thinking blocks)
          const textBlock = content.find((block) => block.type === "text" && typeof block.text === "string");
          if (textBlock?.text) {
            return textBlock.text.slice(0, 500);
          }
          // Fallback: try first block's text directly (legacy format compatibility)
          const fallbackText = content[0]?.text;
          if (typeof fallbackText === "string") {
            return fallbackText.slice(0, 500);
          }
        }
        break;
      }
      case "GEMINI": {
        // Gemini format: response.candidates[0].content.parts[].text
        // Newer models (2024+) may include thinking field in parts
        const candidates = body.candidates as {
          content?: { parts?: { text?: string; thought?: boolean }[] };
        }[] | undefined;
        const parts = candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          // Find the first non-thought text part
          const textPart = parts.find(
            (p) => typeof p.text === "string" && p.text.length > 0 && !p.thought
          );
          if (textPart?.text) {
            return textPart.text.slice(0, 500);
          }
          // Fallback: return first text part regardless of thought flag
          const fallbackPart = parts.find((p) => typeof p.text === "string" && p.text.length > 0);
          if (fallbackPart?.text) {
            return fallbackPart.text.slice(0, 500);
          }
        }
        break;
      }
      case "CODEX": {
        // Codex/Responses API format (2025):
        // response.output[].content[].text where type is "output_text"
        // or response.output[].text for simple text output
        const output = body.output as {
          type?: string;
          content?: { type?: string; text?: string }[];
          text?: string;
        }[] | undefined;

        if (Array.isArray(output)) {
          for (const item of output) {
            // Type "message" with content array
            if (Array.isArray(item.content)) {
              const textContent = item.content.find(
                (c) => c.type === "output_text" && typeof c.text === "string"
              );
              if (textContent?.text) {
                return textContent.text.slice(0, 500);
              }
            }
            // Simple text field on output item
            if (typeof item.text === "string" && item.text.length > 0) {
              return item.text.slice(0, 500);
            }
          }
        }
        break;
      }
      case "IMAGE": {
        // OpenAI Images API format: response.data[].url or response.data[].b64_json
        const imageData = body.data as {
          url?: string;
          b64_json?: string;
          revised_prompt?: string;
        }[] | undefined;

        if (Array.isArray(imageData) && imageData.length > 0) {
          const firstImage = imageData[0];
          if (firstImage.url) {
            return `[Image URL: ${firstImage.url.slice(0, 100)}...]`;
          }
          if (firstImage.b64_json) {
            return `[Image generated: base64 data, ${firstImage.b64_json.length} chars]`;
          }
          if (firstImage.revised_prompt) {
            return `[Image generated with prompt: ${firstImage.revised_prompt.slice(0, 100)}]`;
          }
          return "[Image generated successfully]";
        }
        break;
      }
    }
  } catch {
    // Ignore parsing errors
  }

  // Last resort: try to extract something readable from the response
  try {
    const body = responseBody as Record<string, unknown>;

    // Try common alternative fields
    for (const key of ["text", "output", "result", "data", "response", "message", "answer"]) {
      const val = body[key];
      if (typeof val === "string" && val.length > 0) {
        return stripThinkingBlocks(val).slice(0, 500);
      }
    }

    // Try to find the model field to at least confirm the response is valid
    const model = body.model || body.id;
    if (typeof model === "string") {
      return `[response OK, model: ${model}]`;
    }
  } catch {
    // Ignore
  }

  return undefined;
}

function withTotalLatency(startTime: number, result: DetectionResult): DetectionResult {
  return {
    ...result,
    latency: Date.now() - startTime,
  };
}

async function executeEndpointRequest(
  endpoint: EndpointDetection,
  endpointType: EndpointType,
  proxy?: string | null
): Promise<DetectionResult> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DETECTION_TIMEOUT);

    const fetchOptions = {
      method: "POST" as const,
      headers: endpoint.headers,
      body: JSON.stringify(endpoint.requestBody),
      signal: controller.signal,
    };

    try {
      const response = await proxyFetch(endpoint.url, fetchOptions, proxy);

      const latency = Date.now() - startTime;
      if (response.ok) {
        let responseContent: string | undefined;
        let responseBody: unknown;
        try {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("text/event-stream")) {
            const sseText = await response.text();
            responseContent = extractStreamContent(sseText, endpointType);
            responseBody = parseLastSSEEvent(sseText);
          } else {
            responseBody = await response.json();
            responseContent = extractResponseContent(responseBody, endpointType);
          }
        } catch {
          // Ignore parsing errors
        }

        const bodyError = checkResponseBodyForError(responseBody);
        if (bodyError) {
          return {
            status: CheckStatus.FAIL,
            latency,
            statusCode: response.status,
            errorMsg: bodyError,
            endpointType,
          };
        }

        return {
          status: CheckStatus.SUCCESS,
          latency,
          statusCode: response.status,
          endpointType,
          responseContent,
        };
      }

      let errorMsg = `HTTP ${response.status}`;
      try {
        const errorBody = await response.text();
        errorMsg = errorBody.length > 500 ? errorBody.slice(0, 500) + "..." : errorBody;
      } catch {
        // Ignore error body parsing failures
      }

      return {
        status: CheckStatus.FAIL,
        latency,
        statusCode: response.status,
        errorMsg,
        endpointType,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const latency = Date.now() - startTime;
    let errorMsg = "Unknown error";

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMsg = `Timeout after ${DETECTION_TIMEOUT}ms`;
      } else {
        errorMsg = error.message;
      }
    }

    return {
      status: CheckStatus.FAIL,
      latency,
      errorMsg,
      endpointType,
    };
  }
}

function shouldRetryClaudeProfile(errorMsg: string | undefined, statusCode?: number): boolean {
  if (!errorMsg) {
    return false;
  }

  const lower = errorMsg.toLowerCase();
  const directPatterns = [
    "invalid claude code request",
    "invalid_request_error",
    "invalid request",
    "malformed",
    "missing anthropic-version",
    "missing x-api-key",
    "unsupported request",
  ];

  if (directPatterns.some((pattern) => lower.includes(pattern))) {
    return true;
  }

  if ((statusCode === 400 || statusCode === 422) && lower.includes("request")) {
    return true;
  }

  return false;
}

function formatClaudeAttemptSummary(
  profileId: string,
  statusCode: number | undefined,
  errorMsg: string | undefined
): string {
  const normalized = (errorMsg || "unknown error").replace(/\s+/g, " ").trim();
  const detail = normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
  return `${profileId} [${statusCode ?? "n/a"}] ${detail}`;
}

async function executeClaudeDetection(job: DetectionJobData, proxy?: string | null): Promise<DetectionResult> {
  const overallStartTime = Date.now();
  const orderedProfiles = getOrderedClaudeProfileEndpoints(
    job.baseUrl,
    job.apiKey,
    job.modelName
  );

  const attemptSummaries: string[] = [];
  const triedProfileIds = new Set<string>();
  let lastFailureStatusCode: number | undefined;

  const tryProfile = async (profile: ClaudeProfileEndpoint): Promise<DetectionResult> => {
    const result = await executeEndpointRequest(profile, job.endpointType, proxy);
    attemptSummaries.push(
      formatClaudeAttemptSummary(profile.profileId, result.statusCode, result.errorMsg)
    );
    if (result.status === CheckStatus.FAIL) {
      lastFailureStatusCode = result.statusCode;
    }

    if (isClaudeProbeDebugEnabled()) {
      const headers = profile.headers || {};
      const ua = headers["User-Agent"] || headers["user-agent"] || "";
      const beta = headers["anthropic-beta"] || "";
      const req = profile.requestBody as Record<string, unknown> | undefined;
      const stream = req?.stream === true ? "true" : "false";
      const tools = Array.isArray(req?.tools) ? String(req.tools.length) : "n/a";
      console.log(
        `[claude-probe] channel=${job.channelId} model=${job.modelName} profile=${profile.profileId} status=${result.status} code=${result.statusCode ?? "n/a"} url=${profile.url} stream=${stream} tools=${tools} ua=${ua} beta=${beta}`
      );
    }

    triedProfileIds.add(profile.profileId);
    return result;
  };

  const cachedProfileId = getCachedClaudeProfileId(job);
  if (cachedProfileId) {
    const cachedProfile = getClaudeProfileEndpointById(
      job.baseUrl,
      job.apiKey,
      job.modelName,
      cachedProfileId
    );
    if (cachedProfile) {
      const cachedResult = await tryProfile(cachedProfile);
      if (cachedResult.status === CheckStatus.SUCCESS) {
        setCachedClaudeProfileId(job, cachedProfileId);
        return withTotalLatency(overallStartTime, cachedResult);
      }

      if (!shouldRetryClaudeProfile(cachedResult.errorMsg, cachedResult.statusCode)) {
        return withTotalLatency(overallStartTime, cachedResult);
      }
    }

    clearCachedClaudeProfileId(job);
  }

  for (const profile of orderedProfiles) {
    if (triedProfileIds.has(profile.profileId)) {
      continue;
    }

    const result = await tryProfile(profile);
    if (result.status === CheckStatus.SUCCESS) {
      setCachedClaudeProfileId(job, profile.profileId);
      return withTotalLatency(overallStartTime, result);
    }
  }

  const summary = attemptSummaries.length > 0
    ? `Claude profiles failed: ${attemptSummaries.join("; ")}`
    : "Claude profiles failed: no profile attempts";

  return {
    status: CheckStatus.FAIL,
    latency: Date.now() - overallStartTime,
    statusCode: lastFailureStatusCode,
    errorMsg: summary.length > 1000 ? `${summary.slice(0, 1000)}...` : summary,
    endpointType: job.endpointType,
  };
}

/**
 * Execute detection for a single model
 */
export async function executeDetection(job: DetectionJobData): Promise<DetectionResult> {
  // Use channel proxy if specified, otherwise fall back to global proxy
  const proxy = job.proxy || GLOBAL_PROXY;

  if (job.endpointType === EndpointType.CLAUDE) {
    return executeClaudeDetection(job, proxy);
  }

  const overallStartTime = Date.now();
  const endpoint = buildEndpointDetection(
    job.baseUrl,
    job.apiKey,
    job.modelName,
    job.endpointType
  );

  const result = await executeEndpointRequest(endpoint, job.endpointType, proxy);
  return withTotalLatency(overallStartTime, result);
}

/**
 * Fetch available models from channel's /v1/models endpoint
 */
export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  proxy?: string | null
): Promise<FetchModelsResult> {
  // Normalize baseUrl - remove trailing slash and /v1 suffix if present
  let normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  if (normalizedBaseUrl.endsWith("/v1")) {
    normalizedBaseUrl = normalizedBaseUrl.slice(0, -3);
  }

  const url = `${normalizedBaseUrl}/v1/models`;

  const effectiveProxy = proxy || GLOBAL_PROXY;
  if (effectiveProxy) {
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DETECTION_TIMEOUT);

    try {
      const response = await proxyFetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      }, effectiveProxy);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const errorMsg = `HTTP ${response.status}: ${errorText.slice(0, 200)}`;
        return { models: [], error: errorMsg };
      }

      const data = await response.json();

      // Parse OpenAI-style models response
      if (data && Array.isArray(data.data)) {
        const models = data.data
          .filter((m: unknown): m is { id: string } =>
            m !== null && typeof m === "object" && "id" in m && typeof m.id === "string"
          )
          .map((m: { id: string }) => m.id);

        return { models };
      }

      return { models: [] };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    let errorMsg: string;
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMsg = `请求超时: ${url}`;
      } else {
        const cause = error.cause as { code?: string } | undefined;
        if (cause?.code === "ECONNREFUSED") {
          errorMsg = `无法连接到服务: ${url}`;
        } else if (cause?.code === "ENOTFOUND") {
          errorMsg = `域名解析失败: ${url}`;
        } else {
          errorMsg = error.message;
        }
      }
    } else {
      errorMsg = "未知错误";
    }
    return { models: [], error: errorMsg };
  }
}
