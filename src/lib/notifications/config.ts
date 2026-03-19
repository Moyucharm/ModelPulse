import prisma from "@/lib/prisma";
import { decryptApiKey, encryptApiKey } from "@/lib/crypto";
import type {
  NotificationConfigPayload,
  NotificationConfigView,
  NotificationDispatchConfig,
} from "./types";

type StoredNotificationConfigRecord = {
  telegramEnabled: boolean;
  telegramChatId: string | null;
  telegramBotToken: string | null;
  messageNestEnabled: boolean;
  messageNestUrl: string | null;
  messageNestToken: string | null;
  updatedAt: Date | null;
};

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return "已保存";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isValidHttpUrl(value: string | null): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildStoredConfigRecord(config: Partial<StoredNotificationConfigRecord>): StoredNotificationConfigRecord {
  return {
    telegramEnabled: config.telegramEnabled ?? false,
    telegramChatId: config.telegramChatId ?? null,
    telegramBotToken: config.telegramBotToken ?? null,
    messageNestEnabled: config.messageNestEnabled ?? false,
    messageNestUrl: config.messageNestUrl ?? null,
    messageNestToken: config.messageNestToken ?? null,
    updatedAt: config.updatedAt ?? null,
  };
}

function toDispatchConfig(config: StoredNotificationConfigRecord): NotificationDispatchConfig {
  return {
    telegramEnabled: config.telegramEnabled,
    telegramChatId: config.telegramChatId,
    telegramBotToken: config.telegramBotToken
      ? decryptApiKey(config.telegramBotToken)
      : null,
    messageNestEnabled: config.messageNestEnabled,
    messageNestUrl: config.messageNestUrl,
    messageNestToken: config.messageNestToken
      ? decryptApiKey(config.messageNestToken)
      : null,
  };
}

function buildConfigView(config: StoredNotificationConfigRecord): NotificationConfigView {
  const dispatchConfig = toDispatchConfig(config);

  return {
    telegramEnabled: dispatchConfig.telegramEnabled,
    telegramChatId: dispatchConfig.telegramChatId ?? "",
    telegramHasToken: Boolean(dispatchConfig.telegramBotToken),
    telegramBotTokenMasked: maskSecret(dispatchConfig.telegramBotToken),
    messageNestEnabled: dispatchConfig.messageNestEnabled,
    messageNestUrl: dispatchConfig.messageNestUrl ?? "",
    messageNestHasToken: Boolean(dispatchConfig.messageNestToken),
    messageNestTokenMasked: maskSecret(dispatchConfig.messageNestToken),
    updatedAt: config.updatedAt ? config.updatedAt.toISOString() : null,
  };
}

function resolveDispatchConfig(
  payload: NotificationConfigPayload,
  existing: StoredNotificationConfigRecord,
): NotificationDispatchConfig {
  const existingDispatchConfig = toDispatchConfig(existing);
  const nextTelegramBotTokenInput = normalizeOptionalText(payload.telegramBotToken);
  const nextMessageNestTokenInput = normalizeOptionalText(payload.messageNestToken);

  return {
    telegramEnabled: payload.telegramEnabled ?? existingDispatchConfig.telegramEnabled,
    telegramChatId: payload.telegramChatId !== undefined
      ? normalizeOptionalText(payload.telegramChatId)
      : existingDispatchConfig.telegramChatId,
    telegramBotToken: payload.clearTelegramBotToken
      ? null
      : nextTelegramBotTokenInput ?? existingDispatchConfig.telegramBotToken,
    messageNestEnabled: payload.messageNestEnabled ?? existingDispatchConfig.messageNestEnabled,
    messageNestUrl: payload.messageNestUrl !== undefined
      ? normalizeOptionalText(payload.messageNestUrl)
      : existingDispatchConfig.messageNestUrl,
    messageNestToken: payload.clearMessageNestToken
      ? null
      : nextMessageNestTokenInput ?? existingDispatchConfig.messageNestToken,
  };
}

function validateDispatchConfig(config: NotificationDispatchConfig): void {
  if (config.telegramEnabled && (!config.telegramBotToken || !config.telegramChatId)) {
    throw new Error("启用 Telegram 通知前，请填写 Bot Token 和 Chat ID");
  }

  if (config.messageNestUrl && !isValidHttpUrl(config.messageNestUrl)) {
    throw new Error("Message Nest URL 格式不正确");
  }

  if (config.messageNestEnabled && (!config.messageNestUrl || !config.messageNestToken)) {
    throw new Error("启用 Message Nest 通知前，请填写 URL 和 Token");
  }
}

async function getStoredNotificationConfigRecord(): Promise<StoredNotificationConfigRecord> {
  const config = await prisma.notificationConfig.findUnique({
    where: { id: "default" },
  });

  return buildStoredConfigRecord(config ?? {});
}

export async function getNotificationConfigView(): Promise<NotificationConfigView> {
  const config = await getStoredNotificationConfigRecord();
  return buildConfigView(config);
}

export async function getNotificationDispatchConfig(): Promise<NotificationDispatchConfig> {
  const config = await getStoredNotificationConfigRecord();
  return toDispatchConfig(config);
}

export async function resolveNotificationDispatchConfig(
  payload: NotificationConfigPayload,
): Promise<NotificationDispatchConfig> {
  const existing = await getStoredNotificationConfigRecord();
  const config = resolveDispatchConfig(payload, existing);
  validateDispatchConfig(config);
  return config;
}

export async function updateNotificationConfig(
  payload: NotificationConfigPayload,
): Promise<NotificationConfigView> {
  const existing = await getStoredNotificationConfigRecord();
  const config = resolveDispatchConfig(payload, existing);
  validateDispatchConfig(config);

  const persisted = await prisma.notificationConfig.upsert({
    where: { id: "default" },
    update: {
      telegramEnabled: config.telegramEnabled,
      telegramChatId: config.telegramChatId,
      telegramBotToken: config.telegramBotToken
        ? encryptApiKey(config.telegramBotToken)
        : null,
      messageNestEnabled: config.messageNestEnabled,
      messageNestUrl: config.messageNestUrl,
      messageNestToken: config.messageNestToken
        ? encryptApiKey(config.messageNestToken)
        : null,
    },
    create: {
      id: "default",
      telegramEnabled: config.telegramEnabled,
      telegramChatId: config.telegramChatId,
      telegramBotToken: config.telegramBotToken
        ? encryptApiKey(config.telegramBotToken)
        : null,
      messageNestEnabled: config.messageNestEnabled,
      messageNestUrl: config.messageNestUrl,
      messageNestToken: config.messageNestToken
        ? encryptApiKey(config.messageNestToken)
        : null,
    },
  });

  return buildConfigView(buildStoredConfigRecord(persisted));
}
