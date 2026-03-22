import { HealthStatus } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { getNotificationDispatchConfig } from "./config";
import { buildNotificationMessage, getNotificationEventType } from "./format";
import { sendMessageNestNotification } from "./providers/message-nest";
import { sendTelegramNotification } from "./providers/telegram";
import type {
  ModelEndpointSnapshot,
  ModelNotificationSnapshot,
  NotificationDispatchConfig,
  NotificationDispatchFailure,
  NotificationDispatchResult,
  NotificationMessage,
} from "./types";

function buildSnapshot(model: {
  id: string;
  modelName: string;
  healthStatus: HealthStatus;
  lastCheckedAt: Date | null;
  channel: { name: string };
  modelEndpoints: ModelEndpointSnapshot[];
}): ModelNotificationSnapshot {
  return {
    modelId: model.id,
    channelName: model.channel.name,
    modelName: model.modelName,
    healthStatus: model.healthStatus,
    endpoints: model.modelEndpoints,
    occurredAt: model.lastCheckedAt ?? new Date(),
  };
}

export function buildTestNotificationMessage(now: Date = new Date()): NotificationMessage {
  return {
    eventType: "problem",
    title: "测试通知：ModelPulse",
    body: [
      "这是一条来自 ModelPulse 的测试通知。",
      "如果你收到了这条消息，说明当前通知渠道配置可用。",
      `发送时间：${now.toLocaleString("zh-CN", { hour12: false })}`,
    ].join("\n"),
    summary: "测试通知发送成功",
  };
}

export async function dispatchNotification(
  message: NotificationMessage,
  config?: NotificationDispatchConfig,
): Promise<NotificationDispatchResult> {
  const resolvedConfig = config ?? await getNotificationDispatchConfig();
  const tasks: Array<{
    provider: "Telegram" | "Message Nest";
    task: Promise<void>;
  }> = [];

  if (
    resolvedConfig.telegramEnabled
    && resolvedConfig.telegramBotToken
    && resolvedConfig.telegramChatId
  ) {
    tasks.push({
      provider: "Telegram",
      task: sendTelegramNotification({
        botToken: resolvedConfig.telegramBotToken,
        chatId: resolvedConfig.telegramChatId,
      }, message),
    });
  }

  if (
    resolvedConfig.messageNestEnabled
    && resolvedConfig.messageNestUrl
    && resolvedConfig.messageNestToken
  ) {
    tasks.push({
      provider: "Message Nest",
      task: sendMessageNestNotification({
        url: resolvedConfig.messageNestUrl,
        token: resolvedConfig.messageNestToken,
      }, message),
    });
  }

  if (tasks.length === 0) {
    return {
      deliveredProviders: [],
      failedProviders: [],
    };
  }

  const results = await Promise.allSettled(tasks.map((item) => item.task));
  const deliveredProviders: Array<"Telegram" | "Message Nest"> = [];
  const failedProviders: NotificationDispatchFailure[] = [];

  results.forEach((result, index) => {
    const provider = tasks[index].provider;
    if (result.status === "fulfilled") {
      deliveredProviders.push(provider);
      return;
    }

    failedProviders.push({
      provider,
      message: result.reason instanceof Error
        ? result.reason.message
        : "发送失败",
    });
  });

  return {
    deliveredProviders,
    failedProviders,
  };
}

export async function handleScheduledModelCompletion(modelId: string): Promise<void> {
  const model = await prisma.model.findUnique({
    where: { id: modelId },
    select: {
      id: true,
      modelName: true,
      healthStatus: true,
      lastCheckedAt: true,
      channel: {
        select: { name: true },
      },
      modelEndpoints: {
        select: {
          endpointType: true,
          status: true,
          latency: true,
          statusCode: true,
          errorMsg: true,
        },
        orderBy: { endpointType: "asc" },
      },
      notificationState: {
        select: {
          incidentActive: true,
        },
      },
    },
  });

  if (!model) {
    return;
  }

  const incidentActive = model.notificationState?.incidentActive ?? false;
  const eventType = getNotificationEventType(model.healthStatus, incidentActive);
  if (!eventType) {
    return;
  }

  const snapshot = buildSnapshot(model);
  const message = buildNotificationMessage(eventType, snapshot);

  try {
    const result = await dispatchNotification(message);
    result.failedProviders.forEach((failure) => {
      console.error(`[notifications] ${failure.provider} delivery failed: ${failure.message}`);
    });
  } catch (error) {
    console.error("[notifications] unexpected dispatch failure:", error);
  }

  if (eventType === "problem") {
    await prisma.modelNotificationState.upsert({
      where: { modelId },
      update: {
        incidentActive: true,
        lastProblemAt: snapshot.occurredAt,
        lastProblemSummary: message.summary,
      },
      create: {
        modelId,
        incidentActive: true,
        lastProblemAt: snapshot.occurredAt,
        lastProblemSummary: message.summary,
      },
    });
    return;
  }

  await prisma.modelNotificationState.upsert({
    where: { modelId },
    update: {
      incidentActive: false,
      lastRecoveryAt: snapshot.occurredAt,
      lastProblemSummary: null,
    },
    create: {
      modelId,
      incidentActive: false,
      lastRecoveryAt: snapshot.occurredAt,
      lastProblemSummary: null,
    },
  });
}
