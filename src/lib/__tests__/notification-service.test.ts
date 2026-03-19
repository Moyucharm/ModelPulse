import { describe, expect, it } from "vitest";
import {
  buildTestNotificationMessage,
  dispatchNotification,
} from "@/lib/notifications/service";

describe("notification service", () => {
  it("builds a readable test notification message", () => {
    const message = buildTestNotificationMessage(new Date("2026-03-19T12:34:56.000Z"));

    expect(message.title).toBe("测试通知：model-check");
    expect(message.body).toContain("这是一条来自 model-check 的测试通知");
    expect(message.summary).toBe("测试通知发送成功");
  });

  it("returns empty dispatch result when no provider is enabled", async () => {
    const result = await dispatchNotification(buildTestNotificationMessage(), {
      telegramEnabled: false,
      telegramBotToken: null,
      telegramChatId: null,
      messageNestEnabled: false,
      messageNestUrl: null,
      messageNestToken: null,
    });

    expect(result).toEqual({
      deliveredProviders: [],
      failedProviders: [],
    });
  });
});
