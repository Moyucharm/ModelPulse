import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { resolveNotificationDispatchConfig } from "@/lib/notifications/config";
import {
  buildTestNotificationMessage,
  dispatchNotification,
} from "@/lib/notifications/service";

function buildResultMessage(
  deliveredProviders: string[],
  failedProviders: Array<{ provider: string; message: string }>,
): string {
  if (failedProviders.length === 0) {
    return `测试通知已发送到：${deliveredProviders.join("、")}`;
  }

  if (deliveredProviders.length === 0) {
    return failedProviders
      .map((failure) => `${failure.provider}: ${failure.message}`)
      .join("；");
  }

  return [
    `已发送到：${deliveredProviders.join("、")}`,
    `发送失败：${failedProviders.map((failure) => `${failure.provider}（${failure.message}）`).join("、")}`,
  ].join("；");
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const config = await resolveNotificationDispatchConfig(body);

    if (!config.telegramEnabled && !config.messageNestEnabled) {
      return NextResponse.json(
        { error: "请先启用至少一种通知方式", code: "NO_PROVIDER_ENABLED" },
        { status: 400 },
      );
    }

    const result = await dispatchNotification(buildTestNotificationMessage(), config);
    const message = buildResultMessage(
      result.deliveredProviders,
      result.failedProviders,
    );

    if (result.deliveredProviders.length === 0) {
      return NextResponse.json(
        { error: message, code: "TEST_FAILED" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      partial: result.failedProviders.length > 0,
      deliveredProviders: result.deliveredProviders,
      failedProviders: result.failedProviders,
      message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "测试通知发送失败";
    return NextResponse.json(
      { error: message, code: "TEST_ERROR" },
      { status: 400 },
    );
  }
}
