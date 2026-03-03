import { beforeEach, describe, expect, it, vi } from "vitest";
import { EndpointType } from "@/generated/prisma";
import { executeDetection } from "@/lib/detection/detector";
import { clearClaudeProfileCacheForTests } from "@/lib/detection/claude-profile";

vi.mock("@/lib/utils/proxy-fetch", () => ({
  proxyFetch: vi.fn(),
}));

import { proxyFetch } from "@/lib/utils/proxy-fetch";

const mockedProxyFetch = vi.mocked(proxyFetch);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

function createClaudeJob() {
  return {
    channelId: "channel-1",
    modelId: "model-1",
    modelName: "claude-opus-4-6",
    checkRunId: "run-1",
    baseUrl: "https://example.com",
    apiKey: "test-key",
    endpointType: EndpointType.CLAUDE,
  } as const;
}

describe("claude profile fallback flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearClaudeProfileCacheForTests();
    delete process.env.CLAUDE_PROBE_CUSTOM_PROFILE_JSON;
    delete process.env.CLAUDE_PROBE_DEBUG;
  });

  it("uses first successful profile and then cache hit on the next run", async () => {
    mockedProxyFetch
      .mockResolvedValueOnce(jsonResponse({ error: "invalid claude code request" }))
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: "text", text: "ok" }] }));

    const first = await executeDetection(createClaudeJob());
    expect(first.status).toBe("SUCCESS");
    expect(mockedProxyFetch).toHaveBeenCalledTimes(2);

    mockedProxyFetch.mockResolvedValueOnce(
      jsonResponse({ content: [{ type: "text", text: "cached ok" }] })
    );

    const second = await executeDetection(createClaudeJob());
    expect(second.status).toBe("SUCCESS");
    expect(mockedProxyFetch).toHaveBeenCalledTimes(3);
  });

  it("clears cached profile and falls back when cached request is invalid", async () => {
    mockedProxyFetch
      .mockResolvedValueOnce(jsonResponse({ error: "invalid claude code request" }))
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: "text", text: "ok" }] }));
    await executeDetection(createClaudeJob());

    mockedProxyFetch
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              type: "new_api_error",
              message: "invalid claude code request",
            },
          },
          500
        )
      )
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: "text", text: "fallback ok" }] }));

    const retried = await executeDetection(createClaudeJob());
    expect(retried.status).toBe("SUCCESS");
    expect(mockedProxyFetch).toHaveBeenCalledTimes(4);
  });

  it("returns aggregated failure when all profiles fail", async () => {
    mockedProxyFetch
      .mockResolvedValueOnce(textResponse("bad profile 1", 400))
      .mockResolvedValueOnce(textResponse("bad profile 2", 400))
      .mockResolvedValueOnce(textResponse("bad profile 3", 400))
      .mockResolvedValueOnce(textResponse("bad profile 4", 400))
      .mockResolvedValueOnce(textResponse("bad profile 5", 400))
      .mockResolvedValueOnce(textResponse("bad profile 6", 400))
      .mockResolvedValueOnce(textResponse("bad profile 7", 400))
      .mockResolvedValueOnce(textResponse("bad profile 8", 400))
      .mockResolvedValueOnce(textResponse("bad profile 9", 400))
      .mockResolvedValueOnce(textResponse("bad profile 10", 400));

    const result = await executeDetection(createClaudeJob());
    expect(result.status).toBe("FAIL");
    expect(result.errorMsg).toContain("Claude profiles failed");
    expect(result.errorMsg).toContain("claude_code_blocks_stream");
    expect(result.errorMsg).toContain("claude_code_blocks_nostream");
    expect(result.errorMsg).toContain("claude_code_legacy_nostream");
    expect(result.errorMsg).toContain("anthropic_blocks_nostream");
    expect(result.errorMsg).toContain("bearer_blocks_nostream");
    expect(mockedProxyFetch).toHaveBeenCalledTimes(10);
  });

  it("sends Claude Code marker system block and headers for CC profiles", async () => {
    mockedProxyFetch.mockResolvedValueOnce(jsonResponse({ content: [{ type: "text", text: "ok" }] }));

    const result = await executeDetection(createClaudeJob());
    expect(result.status).toBe("SUCCESS");
    expect(mockedProxyFetch).toHaveBeenCalledTimes(1);

    const [, options] = mockedProxyFetch.mock.calls[0]!;
    const headers = options?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toContain("claude-cli/");
    expect(headers?.["anthropic-beta"]).toContain("claude-code-");
    expect(headers?.["x-app"]).toBe("cli");

    const body = JSON.parse(String(options?.body));
    expect(body.system?.[0]?.text).toContain("You are Claude Code");
    expect(body.metadata?.user_id).toBeTruthy();
  });
});
