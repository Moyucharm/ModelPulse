import { describe, expect, it } from "vitest";
import { buildNotificationMessage, buildProblemDetails, getNotificationEventType } from "@/lib/notifications/format";

describe("notification formatting", () => {
  it("opens a problem event on first unhealthy scheduled result", () => {
    expect(getNotificationEventType("UNHEALTHY", false)).toBe("problem");
  });

  it("does not repeat a problem event while incident is active", () => {
    expect(getNotificationEventType("PARTIAL", true)).toBeNull();
  });

  it("sends recovery after an active incident becomes healthy", () => {
    expect(getNotificationEventType("HEALTHY", true)).toBe("recovery");
  });

  it("builds readable problem details for failed and slow endpoints", () => {
    const details = buildProblemDetails([
      {
        endpointType: "CHAT",
        status: "FAIL",
        latency: 0,
        statusCode: 502,
        errorMsg: "upstream timeout",
      },
      {
        endpointType: "CODEX",
        status: "SUCCESS",
        latency: 31_500,
        statusCode: 200,
        errorMsg: null,
      },
    ]);

    expect(details).toEqual([
      "OpenAI Chat: upstream timeout",
      "OpenAI Responses: 响应过慢（31500ms）",
    ]);
  });

  it("formats a recovery message", () => {
    const message = buildNotificationMessage("recovery", {
      modelId: "model-1",
      channelName: "示例渠道",
      modelName: "gpt-4.1",
      healthStatus: "HEALTHY",
      endpoints: [
        {
          endpointType: "CHAT",
          status: "SUCCESS",
          latency: 1200,
          statusCode: 200,
          errorMsg: null,
        },
      ],
      occurredAt: new Date("2026-03-19T12:00:00.000Z"),
    });

    expect(message.title).toContain("模型恢复");
    expect(message.body).toContain("自动检测发现模型已恢复");
    expect(message.summary).toBe("模型已恢复正常");
  });
});
