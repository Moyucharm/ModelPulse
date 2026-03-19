"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Bell, Loader2, MessageSquare, Send, X } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/ui/toast";
import { ModalPortal, useBodyScrollLock } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

interface NotificationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

interface NotificationConfigResponse {
  telegramEnabled: boolean;
  telegramChatId: string;
  telegramHasToken: boolean;
  telegramBotTokenMasked: string | null;
  messageNestEnabled: boolean;
  messageNestUrl: string;
  messageNestHasToken: boolean;
  messageNestTokenMasked: string | null;
}

type NotificationProvider = "telegram" | "messageNest";

const MESSAGE_NEST_EXAMPLE_URL = "https://notify.example.com/api/v2/message/send";

function ProviderToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (nextValue: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-all",
        checked
          ? "border-primary/70 bg-primary shadow-sm shadow-primary/20"
          : "border-border bg-muted",
      )}
    >
      <span
        className={cn(
          "h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

function ProviderListItem({
  active,
  title,
  description,
  enabled,
  configured,
  icon,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border px-4 py-3 text-left transition-all",
        active
          ? "border-primary/40 bg-primary/10 shadow-sm"
          : "border-border/70 bg-muted/15 hover:bg-muted/35",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="shrink-0">{icon}</span>
            <span className="truncate">{title}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <div className="shrink-0 space-y-1 text-right">
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
              enabled
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {enabled ? "已启用" : "未启用"}
          </span>
          <div className="text-[11px] text-muted-foreground">
            {configured ? "已配置" : "待配置"}
          </div>
        </div>
      </div>
    </button>
  );
}

export function NotificationSettingsModal({
  isOpen,
  onClose,
  onSave,
}: NotificationSettingsModalProps) {
  const { token } = useAuth();
  const { toast } = useToast();

  useBodyScrollLock(isOpen);

  const [selectedProvider, setSelectedProvider] = useState<NotificationProvider>("telegram");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramHasToken, setTelegramHasToken] = useState(false);
  const [telegramBotTokenMasked, setTelegramBotTokenMasked] = useState<string | null>(null);
  const [clearTelegramBotToken, setClearTelegramBotToken] = useState(false);
  const [messageNestEnabled, setMessageNestEnabled] = useState(false);
  const [messageNestUrl, setMessageNestUrl] = useState("");
  const [messageNestToken, setMessageNestToken] = useState("");
  const [messageNestHasToken, setMessageNestHasToken] = useState(false);
  const [messageNestTokenMasked, setMessageNestTokenMasked] = useState<string | null>(null);
  const [clearMessageNestToken, setClearMessageNestToken] = useState(false);

  useEffect(() => {
    if (!isOpen || !token) {
      return;
    }

    const controller = new AbortController();

    const loadConfig = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/notifications/config", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("加载通知配置失败");
        }

        const data = await response.json();
        const config = data.config as NotificationConfigResponse;

        setTelegramEnabled(config.telegramEnabled);
        setTelegramChatId(config.telegramChatId);
        setTelegramBotToken("");
        setTelegramHasToken(config.telegramHasToken);
        setTelegramBotTokenMasked(config.telegramBotTokenMasked);
        setClearTelegramBotToken(false);
        setMessageNestEnabled(config.messageNestEnabled);
        setMessageNestUrl(config.messageNestUrl);
        setMessageNestToken("");
        setMessageNestHasToken(config.messageNestHasToken);
        setMessageNestTokenMasked(config.messageNestTokenMasked);
        setClearMessageNestToken(false);

        if (
          config.messageNestEnabled
          || config.messageNestHasToken
          || Boolean(config.messageNestUrl)
        ) {
          setSelectedProvider("messageNest");
        } else {
          setSelectedProvider("telegram");
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        toast("加载通知配置失败", "error");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadConfig();

    return () => controller.abort();
  }, [isOpen, token, toast]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();

    if (!token) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/notifications/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          telegramEnabled,
          telegramChatId,
          telegramBotToken,
          clearTelegramBotToken,
          messageNestEnabled,
          messageNestUrl,
          messageNestToken,
          clearMessageNestToken,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "保存通知配置失败");
      }

      const config = data.config as NotificationConfigResponse;
      setTelegramBotToken("");
      setTelegramHasToken(config.telegramHasToken);
      setTelegramBotTokenMasked(config.telegramBotTokenMasked);
      setClearTelegramBotToken(false);
      setMessageNestToken("");
      setMessageNestHasToken(config.messageNestHasToken);
      setMessageNestTokenMasked(config.messageNestTokenMasked);
      setClearMessageNestToken(false);
      toast("通知配置已保存", "success");
      onSave?.();
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存通知配置失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!token) {
      return;
    }

    setTesting(true);
    try {
      const response = await fetch("/api/notifications/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          telegramEnabled,
          telegramChatId,
          telegramBotToken,
          clearTelegramBotToken,
          messageNestEnabled,
          messageNestUrl,
          messageNestToken,
          clearMessageNestToken,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "测试通知发送失败");
      }

      toast(data.message || "测试通知已发送", data.partial ? "error" : "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "测试通知发送失败", "error");
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  const telegramConfigured = telegramHasToken || Boolean(telegramBotToken) || Boolean(telegramChatId);
  const messageNestConfigured = messageNestHasToken || Boolean(messageNestToken) || Boolean(messageNestUrl);

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-settings-modal-title"
      >
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
        <div className="relative m-4 w-[920px] max-w-[96vw] rounded-lg border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 id="notification-settings-modal-title" className="flex items-center gap-2 text-lg font-semibold">
              <Bell className="h-5 w-5 text-amber-500" />
              通知设置
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 transition-colors hover:bg-accent"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4 px-5 py-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                仅自动检测会触发通知；同一模型持续故障时只提醒一次，恢复后才会再次发送恢复通知。
              </div>

              <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
                <aside className="space-y-2">
                  <ProviderListItem
                    active={selectedProvider === "telegram"}
                    title="Telegram Bot"
                    description="适合发到私聊或群组，使用 Bot Token 与 Chat ID。"
                    enabled={telegramEnabled}
                    configured={telegramConfigured}
                    icon={<Send className="h-4 w-4 text-sky-500" />}
                    onClick={() => setSelectedProvider("telegram")}
                  />
                  <ProviderListItem
                    active={selectedProvider === "messageNest"}
                    title="Message Nest"
                    description="适合接入你自己的通知网关，使用 URL 与 Token。"
                    enabled={messageNestEnabled}
                    configured={messageNestConfigured}
                    icon={<MessageSquare className="h-4 w-4 text-emerald-500" />}
                    onClick={() => setSelectedProvider("messageNest")}
                  />
                </aside>

                <section className="min-w-0 rounded-xl border border-border/70 bg-muted/20 p-4 sm:p-5">
                  {selectedProvider === "telegram" ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-base font-medium">
                            <Send className="h-4 w-4 text-sky-500" />
                            Telegram Bot
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            使用 Bot Token + Chat ID 推送异常与恢复消息。
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            {telegramEnabled ? "已启用" : "未启用"}
                          </span>
                          <ProviderToggle
                            checked={telegramEnabled}
                            onChange={setTelegramEnabled}
                            label="切换 Telegram 通知"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium">Bot Token</label>
                        <input
                          type="password"
                          value={telegramBotToken}
                          onChange={(event) => {
                            setTelegramBotToken(event.target.value);
                            setClearTelegramBotToken(false);
                          }}
                          className="w-full rounded-md border border-input bg-background px-3 py-2"
                          placeholder={telegramHasToken ? "留空则保持当前 Token" : "123456789:AA..."}
                        />
                        {(telegramHasToken || clearTelegramBotToken) && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>
                              {clearTelegramBotToken
                                ? "当前会清空已保存的 Telegram Token"
                                : `已保存 Token：${telegramBotTokenMasked ?? "已保存"}`}
                            </span>
                            {telegramHasToken && !clearTelegramBotToken && (
                              <button
                                type="button"
                                onClick={() => {
                                  setTelegramBotToken("");
                                  setClearTelegramBotToken(true);
                                  setTelegramHasToken(false);
                                }}
                                className="text-rose-500 transition-colors hover:text-rose-600"
                              >
                                清空
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium">Chat ID</label>
                        <input
                          type="text"
                          value={telegramChatId}
                          onChange={(event) => setTelegramChatId(event.target.value)}
                          className="w-full rounded-md border border-input bg-background px-3 py-2"
                          placeholder="-1001234567890"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          群组通常是负数，私聊通常是正数；如果使用群组，请先把 Bot 拉进群里。
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-base font-medium">
                            <MessageSquare className="h-4 w-4 text-emerald-500" />
                            Message Nest
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            通过面板填写 URL 与 Token，请求体会携带 `title` 与 `context` placeholders。
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            {messageNestEnabled ? "已启用" : "未启用"}
                          </span>
                          <ProviderToggle
                            checked={messageNestEnabled}
                            onChange={setMessageNestEnabled}
                            label="切换 Message Nest 通知"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium">接口 URL</label>
                        <input
                          type="url"
                          value={messageNestUrl}
                          onChange={(event) => setMessageNestUrl(event.target.value)}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                          placeholder="输入 Message Nest 发送接口 URL"
                        />
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          示例：<span className="font-mono">{MESSAGE_NEST_EXAMPLE_URL}</span>
                        </p>
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium">Token</label>
                        <input
                          type="password"
                          value={messageNestToken}
                          onChange={(event) => {
                            setMessageNestToken(event.target.value);
                            setClearMessageNestToken(false);
                          }}
                          className="w-full rounded-md border border-input bg-background px-3 py-2"
                          placeholder={messageNestHasToken ? "留空则保持当前 Token" : "输入 Message Nest Token"}
                        />
                        {(messageNestHasToken || clearMessageNestToken) && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>
                              {clearMessageNestToken
                                ? "当前会清空已保存的 Message Nest Token"
                                : `已保存 Token：${messageNestTokenMasked ?? "已保存"}`}
                            </span>
                            {messageNestHasToken && !clearMessageNestToken && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMessageNestToken("");
                                  setClearMessageNestToken(true);
                                  setMessageNestHasToken(false);
                                }}
                                className="text-rose-500 transition-colors hover:text-rose-600"
                              >
                                清空
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </div>

              <div className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                建议同时设置 `ENCRYPTION_KEY`，这样保存到数据库中的通知 Token 也会加密。
              </div>

              <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={loading || saving || testing}
                  className="flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  发送测试通知
                </button>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={saving || testing}
                    className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    保存
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
