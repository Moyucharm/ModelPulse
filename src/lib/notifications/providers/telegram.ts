import type { NotificationMessage } from "../types";

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export async function sendTelegramNotification(
  config: TelegramConfig,
  message: NotificationMessage,
): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: `${message.title}\n\n${message.body}`,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram 发送失败: ${body || response.statusText}`);
  }
}
