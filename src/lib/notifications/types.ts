import type {
  CheckStatus,
  EndpointType,
  HealthStatus,
} from "@/generated/prisma";

export type NotificationEventType = "problem" | "recovery";

export interface ModelEndpointSnapshot {
  endpointType: EndpointType;
  status: CheckStatus;
  latency: number | null;
  statusCode: number | null;
  errorMsg: string | null;
}

export interface ModelNotificationSnapshot {
  modelId: string;
  channelName: string;
  modelName: string;
  healthStatus: HealthStatus;
  endpoints: ModelEndpointSnapshot[];
  occurredAt: Date;
}

export interface NotificationMessage {
  eventType: NotificationEventType;
  title: string;
  body: string;
  summary: string;
}

export interface NotificationDispatchConfig {
  telegramEnabled: boolean;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  messageNestEnabled: boolean;
  messageNestUrl: string | null;
  messageNestToken: string | null;
}

export interface NotificationDispatchFailure {
  provider: "Telegram" | "Message Nest";
  message: string;
}

export interface NotificationDispatchResult {
  deliveredProviders: Array<"Telegram" | "Message Nest">;
  failedProviders: NotificationDispatchFailure[];
}

export interface NotificationConfigView {
  telegramEnabled: boolean;
  telegramChatId: string;
  telegramHasToken: boolean;
  telegramBotTokenMasked: string | null;
  messageNestEnabled: boolean;
  messageNestUrl: string;
  messageNestHasToken: boolean;
  messageNestTokenMasked: string | null;
  updatedAt: string | null;
}

export interface NotificationConfigPayload {
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  clearTelegramBotToken?: boolean;
  messageNestEnabled?: boolean;
  messageNestUrl?: string;
  messageNestToken?: string;
  clearMessageNestToken?: boolean;
}
