import type { NotificationMessage } from "../types";

interface MessageNestConfig {
  url: string;
  token: string;
}

export async function sendMessageNestNotification(
  config: MessageNestConfig,
  message: NotificationMessage,
): Promise<void> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: config.token,
      title: message.title,
      placeholders: {
        title: message.title,
        context: message.body,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Message Nest 发送失败: ${body || response.statusText}`);
  }
}
