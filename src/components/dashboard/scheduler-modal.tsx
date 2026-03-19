// Scheduler configuration modal
// Uses select-driven cron rules instead of free-form input

"use client";

import { useState, useEffect, FormEvent } from "react";
import { X, Loader2, Clock } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useToast } from "@/components/ui/toast";
import { ModalPortal, useBodyScrollLock } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

interface SchedulerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

type ScheduleMode = "minute" | "hour" | "day" | "week" | "month";

const CRON_SCHEDULE_SEPARATOR = "||";
const INTERVAL_PREFIX = "interval:";
const MAX_DAILY_RUNS = 6;
const DEFAULT_DAY_TIMES = ["00:00", "08:00", "12:00", "18:00", "20:00", "22:00"];

const SCHEDULE_MODE_OPTIONS: Array<{ value: ScheduleMode; label: string }> = [
  { value: "minute", label: "按分钟" },
  { value: "hour", label: "按小时" },
  { value: "day", label: "按天" },
  { value: "week", label: "按周" },
  { value: "month", label: "按月" },
];

const INTERVAL_RANGES = {
  minute: { min: 1, max: 59, unitLabel: "分钟" },
  hour: { min: 1, max: 24, unitLabel: "小时" },
  day: { min: 1, max: 7, unitLabel: "天" },
} as const;

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => index);
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => index);
const DAY_OF_MONTH_OPTIONS = Array.from({ length: 31 }, (_, index) => index + 1);

const INTERVAL_VALUE_OPTIONS = {
  minute: Array.from({ length: 59 }, (_, index) => index + 1),
  hour: Array.from({ length: 24 }, (_, index) => index + 1),
  day: Array.from({ length: 7 }, (_, index) => index + 1),
} as const;

const WEEKDAY_OPTIONS = [
  { value: 0, label: "周日" },
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
];

interface ParsedScheduleConfig {
  mode: ScheduleMode;
  intervalValue: number;
  minute: number;
  hour: number;
  weekday: number;
  dayOfMonth: number;
  dayRunCount: number;
  dayTimes: string[];
}

interface DailyCronEntry {
  minute: number;
  hour: number;
  dayInterval: number;
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function formatTime(hour: number, minute: number): string {
  return `${padNumber(hour)}:${padNumber(minute)}`;
}

function normalizeDayTimes(times: string[]): string[] {
  const normalized = [...DEFAULT_DAY_TIMES];
  times.slice(0, MAX_DAILY_RUNS).forEach((time, index) => {
    normalized[index] = time;
  });
  return normalized;
}

function isValidTimeString(time: string): boolean {
  return /^\d{2}:\d{2}$/.test(time);
}

function isStrictlyIncreasingTimes(times: string[]): boolean {
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] <= times[i - 1]) return false;
  }
  return true;
}

function parseTimeString(time: string): { hour: number; minute: number } | null {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

function updateTimeString(time: string, part: "hour" | "minute", value: number): string {
  const parsed = parseTimeString(time) ?? { hour: 0, minute: 0 };
  return formatTime(
    part === "hour" ? value : parsed.hour,
    part === "minute" ? value : parsed.minute
  );
}

function splitCronSchedules(cronSchedule: string): string[] {
  return cronSchedule
    .split(CRON_SCHEDULE_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createDefaultScheduleConfig(): ParsedScheduleConfig {
  return {
    mode: "hour",
    intervalValue: 1,
    minute: 0,
    hour: 0,
    weekday: 1,
    dayOfMonth: 1,
    dayRunCount: 1,
    dayTimes: normalizeDayTimes(["00:00"]),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseDailyCronEntry(schedule: string): DailyCronEntry | null {
  const singleDayMatch = schedule.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (singleDayMatch) {
    const minute = Number(singleDayMatch[1]);
    const hour = Number(singleDayMatch[2]);
    if (minute <= 59 && hour <= 23) {
      return { minute, hour, dayInterval: 1 };
    }
  }

  const intervalDayMatch = schedule.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\/(\d{1,2})\s+\*\s+\*$/);
  if (intervalDayMatch) {
    const minute = Number(intervalDayMatch[1]);
    const hour = Number(intervalDayMatch[2]);
    const dayInterval = Number(intervalDayMatch[3]);
    if (
      minute <= 59
      && hour <= 23
      && dayInterval >= INTERVAL_RANGES.day.min
      && dayInterval <= INTERVAL_RANGES.day.max
    ) {
      return { minute, hour, dayInterval };
    }
  }

  return null;
}

function parseIntervalSchedule(schedule: string): ParsedScheduleConfig | null {
  const defaults = createDefaultScheduleConfig();
  const trimmed = schedule.trim();
  if (!trimmed.startsWith(INTERVAL_PREFIX)) {
    return null;
  }

  const [prefix, unitPart, valuePart, ...anchorParts] = trimmed.split(":");
  if (prefix !== "interval") {
    return defaults;
  }

  if (!(unitPart in INTERVAL_RANGES)) {
    return defaults;
  }

  const unit = unitPart as keyof typeof INTERVAL_RANGES;
  const value = Number(valuePart);
  const range = INTERVAL_RANGES[unit];
  if (Number.isNaN(value) || value < range.min || value > range.max) {
    return defaults;
  }

  const anchorWithMeta = anchorParts.join(":");
  const [anchorIso, ...metaSegments] = anchorWithMeta.split("|");
  const anchorDate = new Date(anchorIso);
  const anchorHour = Number.isNaN(anchorDate.getTime()) ? 0 : anchorDate.getHours();
  const anchorMinute = Number.isNaN(anchorDate.getTime()) ? 0 : anchorDate.getMinutes();

  if (unit === "minute") {
    return {
      ...defaults,
      mode: "minute",
      intervalValue: value,
    };
  }

  if (unit === "hour") {
    return {
      ...defaults,
      mode: "hour",
      intervalValue: value,
      minute: anchorMinute,
      hour: anchorHour,
    };
  }

  const timesSegment = metaSegments.find((item) => item.startsWith("times="));
  const parsedTimes = timesSegment
    ? timesSegment
        .slice("times=".length)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [formatTime(anchorHour, anchorMinute)];

  const validTimes = parsedTimes
    .filter(isValidTimeString)
    .sort();

  const dayTimes = validTimes.length > 0 ? validTimes : [formatTime(anchorHour, anchorMinute)];
  const firstTime = parseTimeString(dayTimes[0]) ?? { hour: 0, minute: 0 };

  return {
    ...defaults,
    mode: "day",
    intervalValue: value,
    hour: firstTime.hour,
    minute: firstTime.minute,
    dayRunCount: clamp(dayTimes.length, 1, MAX_DAILY_RUNS),
    dayTimes: normalizeDayTimes(dayTimes),
  };
}

function parseCronSchedule(schedule: string): ParsedScheduleConfig | null {
  const defaults = createDefaultScheduleConfig();
  const schedules = splitCronSchedules(schedule);

  if (schedules.length === 0) {
    return null;
  }

  if (schedules.length === 1) {
    const [single] = schedules;

    if (single === "* * * * *") {
      return {
        ...defaults,
        mode: "minute",
        intervalValue: 1,
      };
    }

    const everyMinuteMatch = single.match(/^\*\/(\d{1,2})\s+\*\s+\*\s+\*\s+\*$/);
    if (everyMinuteMatch) {
      const value = Number(everyMinuteMatch[1]);
      if (value >= INTERVAL_RANGES.minute.min && value <= INTERVAL_RANGES.minute.max) {
        return {
          ...defaults,
          mode: "minute",
          intervalValue: value,
        };
      }
    }

    const hourlyEveryMatch = single.match(/^(\d{1,2})\s+\*\/(\d{1,2})\s+\*\s+\*\s+\*$/);
    if (hourlyEveryMatch) {
      const minute = Number(hourlyEveryMatch[1]);
      const value = Number(hourlyEveryMatch[2]);
      if (minute <= 59 && value >= INTERVAL_RANGES.hour.min && value <= INTERVAL_RANGES.hour.max) {
        return {
          ...defaults,
          mode: "hour",
          intervalValue: value,
          minute,
        };
      }
    }

    const hourlyMatch = single.match(/^(\d{1,2})\s+\*\s+\*\s+\*\s+\*$/);
    if (hourlyMatch) {
      const minute = Number(hourlyMatch[1]);
      if (minute <= 59) {
        return {
          ...defaults,
          mode: "hour",
          intervalValue: 1,
          minute,
        };
      }
    }

    const weeklyMatch = single.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-6])$/);
    if (weeklyMatch) {
      const minute = Number(weeklyMatch[1]);
      const hour = Number(weeklyMatch[2]);
      const weekday = Number(weeklyMatch[3]);
      if (minute <= 59 && hour <= 23) {
        return {
          ...defaults,
          mode: "week",
          minute,
          hour,
          weekday,
        };
      }
    }

    const monthlyMatch = single.match(/^(\d{1,2})\s+(\d{1,2})\s+([1-9]|[12]\d|3[01])\s+\*\s+\*$/);
    if (monthlyMatch) {
      const minute = Number(monthlyMatch[1]);
      const hour = Number(monthlyMatch[2]);
      const dayOfMonth = Number(monthlyMatch[3]);
      if (minute <= 59 && hour <= 23) {
        return {
          ...defaults,
          mode: "month",
          minute,
          hour,
          dayOfMonth,
        };
      }
    }
  }

  const dailyEntries = schedules
    .map(parseDailyCronEntry)
    .filter((entry): entry is DailyCronEntry => entry !== null)
    .sort((left, right) => {
      if (left.hour !== right.hour) return left.hour - right.hour;
      return left.minute - right.minute;
    });

  if (dailyEntries.length === schedules.length && dailyEntries.length > 0) {
    const dayInterval = dailyEntries[0].dayInterval;
    if (dailyEntries.every((entry) => entry.dayInterval === dayInterval)) {
      const dayTimes = dailyEntries.map((entry) => formatTime(entry.hour, entry.minute));
      const firstTime = dailyEntries[0];
      return {
        ...defaults,
        mode: "day",
        intervalValue: dayInterval,
        hour: firstTime.hour,
        minute: firstTime.minute,
        dayRunCount: clamp(dayTimes.length, 1, MAX_DAILY_RUNS),
        dayTimes: normalizeDayTimes(dayTimes),
      };
    }
  }

  return null;
}

function parseStoredSchedule(schedule: string): ParsedScheduleConfig {
  return parseIntervalSchedule(schedule) ?? parseCronSchedule(schedule) ?? createDefaultScheduleConfig();
}

function buildCronSchedule(config: ParsedScheduleConfig): string {
  if (config.mode === "minute") {
    return config.intervalValue === 1
      ? "* * * * *"
      : `*/${config.intervalValue} * * * *`;
  }

  if (config.mode === "hour") {
    const hourField = config.intervalValue === 1 ? "*" : `*/${config.intervalValue}`;
    return `${config.minute} ${hourField} * * *`;
  }

  if (config.mode === "day") {
    const dayField = config.intervalValue === 1 ? "*" : `*/${config.intervalValue}`;
    const selectedTimes = config.dayTimes.slice(0, config.dayRunCount);
    return selectedTimes
      .map((time) => {
        const parsed = parseTimeString(time) ?? { hour: 0, minute: 0 };
        return `${parsed.minute} ${parsed.hour} ${dayField} * *`;
      })
      .join(CRON_SCHEDULE_SEPARATOR);
  }

  if (config.mode === "week") {
    return `${config.minute} ${config.hour} * * ${config.weekday}`;
  }

  return `${config.minute} ${config.hour} ${config.dayOfMonth} * *`;
}

function validateDayTimes(dayRunCount: number, dayTimes: string[]): string | null {
  const selected = dayTimes.slice(0, dayRunCount);
  if (selected.some((time) => !isValidTimeString(time))) {
    return "执行时间格式不正确";
  }
  if (!isStrictlyIncreasingTimes(selected)) {
    return "执行时间必须按顺序递增，且不能重复";
  }
  return null;
}

function getScheduleSummary(config: ParsedScheduleConfig): string {
  if (config.mode === "minute") {
    return config.intervalValue === 1
      ? "每分钟执行一次"
      : `每隔 ${config.intervalValue} 分钟执行一次`;
  }

  if (config.mode === "hour") {
    return config.intervalValue === 1
      ? `每小时第 ${padNumber(config.minute)} 分执行`
      : `每隔 ${config.intervalValue} 小时，在第 ${padNumber(config.minute)} 分执行`;
  }

  if (config.mode === "day") {
    const selectedTimes = config.dayTimes.slice(0, config.dayRunCount).join("、");
    return config.intervalValue === 1
      ? `每天 ${selectedTimes} 执行`
      : `每隔 ${config.intervalValue} 天在 ${selectedTimes} 执行`;
  }

  if (config.mode === "week") {
    const weekdayLabel = WEEKDAY_OPTIONS.find((item) => item.value === config.weekday)?.label ?? "周一";
    return `每周 ${weekdayLabel} ${formatTime(config.hour, config.minute)} 执行`;
  }

  return `每月 ${config.dayOfMonth} 日 ${formatTime(config.hour, config.minute)} 执行`;
}

export function SchedulerModal({ isOpen, onClose, onSave }: SchedulerModalProps) {
  const { token } = useAuth();
  const { toast } = useToast();

  useBodyScrollLock(isOpen);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nextRun, setNextRun] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("hour");
  const [intervalValue, setIntervalValue] = useState(1);
  const [minuteOfHour, setMinuteOfHour] = useState(0);
  const [hourOfDay, setHourOfDay] = useState(0);
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [dayRunCount, setDayRunCount] = useState(1);
  const [dayTimes, setDayTimes] = useState<string[]>(normalizeDayTimes(["00:00"]));
  const [channelConcurrency, setChannelConcurrency] = useState(5);
  const [maxGlobalConcurrency, setMaxGlobalConcurrency] = useState(30);
  const [minDelayMs, setMinDelayMs] = useState(3000);
  const [maxDelayMs, setMaxDelayMs] = useState(5000);

  useEffect(() => {
    if (!isOpen || !token) return;

    const controller = new AbortController();

    const loadConfig = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/scheduler/config", {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error("Failed to load config");

        const data = await response.json();
        if (controller.signal.aborted) return;

        const parsedSchedule = parseStoredSchedule(data.config.cronSchedule);

        setNextRun(data.nextRun);
        setEnabled(data.config.enabled);
        setScheduleMode(parsedSchedule.mode);
        setIntervalValue(parsedSchedule.intervalValue);
        setMinuteOfHour(parsedSchedule.minute);
        setHourOfDay(parsedSchedule.hour);
        setWeekday(parsedSchedule.weekday);
        setDayOfMonth(parsedSchedule.dayOfMonth);
        setDayRunCount(parsedSchedule.dayRunCount);
        setDayTimes(parsedSchedule.dayTimes);
        setChannelConcurrency(data.config.channelConcurrency);
        setMaxGlobalConcurrency(data.config.maxGlobalConcurrency);
        setMinDelayMs(data.config.minDelayMs);
        setMaxDelayMs(data.config.maxDelayMs);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (!controller.signal.aborted) {
          toast("加载配置失败", "error");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadConfig();
    return () => controller.abort();
  }, [isOpen, token, toast]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();

    if (["minute", "hour", "day"].includes(scheduleMode)) {
      const range = INTERVAL_RANGES[scheduleMode as keyof typeof INTERVAL_RANGES];
      if (intervalValue < range.min || intervalValue > range.max) {
        toast(`${range.unitLabel}范围是 ${range.min}-${range.max}`, "error");
        return;
      }
    }

    if (scheduleMode === "day") {
      const dayTimeError = validateDayTimes(dayRunCount, dayTimes);
      if (dayTimeError) {
        toast(dayTimeError, "error");
        return;
      }
    }

    const scheduleConfig: ParsedScheduleConfig = {
      mode: scheduleMode,
      intervalValue,
      minute: minuteOfHour,
      hour: hourOfDay,
      weekday,
      dayOfMonth,
      dayRunCount,
      dayTimes,
    };

    setSaving(true);
    try {
      const cronSchedule = buildCronSchedule(scheduleConfig);
      const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

      const response = await fetch("/api/scheduler/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          enabled,
          cronSchedule,
          timezone: localTimezone,
          channelConcurrency,
          maxGlobalConcurrency,
          minDelayMs,
          maxDelayMs,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "保存失败");
      }

      const data = await response.json();
      setNextRun(data.nextRun);
      toast("配置已保存", "success");
      onSave?.();
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const formatNextRun = (isoString: string | null): string => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    return date.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduler-modal-title"
      >
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
        <div className="relative m-4 w-[720px] max-w-[95vw] rounded-lg border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 id="scheduler-modal-title" className="flex items-center gap-2 text-lg font-semibold">
              <Clock className="h-5 w-5 text-blue-500" />
              定时检测设置
            </h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 hover:bg-accent transition-colors"
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
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">启用自动检测</label>
                <button
                  type="button"
                  onClick={() => setEnabled(!enabled)}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    enabled ? "bg-primary" : "bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      enabled ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>

              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-medium">Cron 规则</label>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  {SCHEDULE_MODE_OPTIONS.map((option) => {
                    const active = scheduleMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setScheduleMode(option.value)}
                        className={cn(
                          "rounded-lg border px-3 py-3 text-center transition-colors",
                          active
                            ? "border-primary/70 bg-background ring-1 ring-primary/20"
                            : "border-border/70 bg-background hover:border-primary/30 hover:bg-accent/20"
                        )}
                      >
                        <div className="text-sm font-medium">{option.label}</div>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-lg border border-border/70 bg-background p-3">
                  {scheduleMode === "minute" && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span>每隔</span>
                      <select
                        value={intervalValue}
                        onChange={(e) => setIntervalValue(Number(e.target.value))}
                        className="rounded-md border border-input bg-background px-3 py-2"
                      >
                        {INTERVAL_VALUE_OPTIONS.minute.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <span>分钟执行一次</span>
                    </div>
                  )}

                  {scheduleMode === "hour" && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span>每隔</span>
                      <select
                        value={intervalValue}
                        onChange={(e) => setIntervalValue(Number(e.target.value))}
                        className="rounded-md border border-input bg-background px-3 py-2"
                      >
                        {INTERVAL_VALUE_OPTIONS.hour.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <span>小时，在第</span>
                      <select
                        value={minuteOfHour}
                        onChange={(e) => setMinuteOfHour(Number(e.target.value))}
                        className="rounded-md border border-input bg-background px-3 py-2"
                      >
                        {MINUTE_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <span>分钟执行</span>
                    </div>
                  )}

                  {scheduleMode === "day" && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span>每隔</span>
                        <select
                          value={intervalValue}
                          onChange={(e) => setIntervalValue(Number(e.target.value))}
                          className="rounded-md border border-input bg-background px-3 py-2"
                        >
                          {INTERVAL_VALUE_OPTIONS.day.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                        <span>天执行</span>
                        <select
                          value={dayRunCount}
                          onChange={(e) => setDayRunCount(Number(e.target.value))}
                          className="rounded-md border border-input bg-background px-3 py-2"
                        >
                          {Array.from({ length: MAX_DAILY_RUNS }, (_, index) => index + 1).map((count) => (
                            <option key={count} value={count}>
                              {count} 次
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {Array.from({ length: dayRunCount }, (_, index) => (
                          <div key={`day-time-${index}`} className="rounded-md border border-border/70 bg-muted/20 p-2">
                            <div className="mb-2 text-xs text-muted-foreground">第 {index + 1} 次</div>
                            <div className="flex items-center gap-2">
                              <select
                                value={parseTimeString(dayTimes[index])?.hour ?? 0}
                                onChange={(e) => {
                                  const nextTimes = [...dayTimes];
                                  nextTimes[index] = updateTimeString(dayTimes[index], "hour", Number(e.target.value));
                                  setDayTimes(nextTimes);
                                }}
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              >
                                {HOUR_OPTIONS.map((value) => (
                                  <option key={value} value={value}>
                                    {padNumber(value)} 时
                                  </option>
                                ))}
                              </select>
                              <select
                                value={parseTimeString(dayTimes[index])?.minute ?? 0}
                                onChange={(e) => {
                                  const nextTimes = [...dayTimes];
                                  nextTimes[index] = updateTimeString(dayTimes[index], "minute", Number(e.target.value));
                                  setDayTimes(nextTimes);
                                }}
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              >
                                {MINUTE_OPTIONS.map((value) => (
                                  <option key={value} value={value}>
                                    {value} 分
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        同一天内的执行时间必须按顺序递增，系统会自动生成多条 cron 规则。
                      </p>
                    </div>
                  )}

                  {scheduleMode === "week" && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span>每周</span>
                      <select
                        value={weekday}
                        onChange={(e) => setWeekday(Number(e.target.value))}
                        className="rounded-md border border-input bg-background px-3 py-2"
                      >
                        {WEEKDAY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={hourOfDay}
                        onChange={(e) => setHourOfDay(Number(e.target.value))}
                        className="rounded-md border border-input bg-background px-3 py-2"
                      >
                        {HOUR_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {padNumber(value)} 时
                          </option>
                        ))}
                      </select>
                      <select
                        value={minuteOfHour}
                        onChange={(e) => setMinuteOfHour(Number(e.target.value))}
                        className="rounded-md border border-input bg-background px-3 py-2"
                      >
                        {MINUTE_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {value} 分
                          </option>
                        ))}
                      </select>
                      <span>执行</span>
                    </div>
                  )}

                  {scheduleMode === "month" && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span>每月</span>
                      <select
                        value={dayOfMonth}
                        onChange={(e) => setDayOfMonth(Number(e.target.value))}
                        className="rounded-md border border-input bg-background px-3 py-2"
                      >
                        {DAY_OF_MONTH_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {value} 日
                          </option>
                        ))}
                      </select>
                      <select
                        value={hourOfDay}
                        onChange={(e) => setHourOfDay(Number(e.target.value))}
                        className="rounded-md border border-input bg-background px-3 py-2"
                      >
                        {HOUR_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {padNumber(value)} 时
                          </option>
                        ))}
                      </select>
                      <select
                        value={minuteOfHour}
                        onChange={(e) => setMinuteOfHour(Number(e.target.value))}
                        className="rounded-md border border-input bg-background px-3 py-2"
                      >
                        {MINUTE_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {value} 分
                          </option>
                        ))}
                      </select>
                      <span>执行</span>
                    </div>
                  )}
                </div>

                <div className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <div>规则说明：{getScheduleSummary({
                    mode: scheduleMode,
                    intervalValue,
                    minute: minuteOfHour,
                    hour: hourOfDay,
                    weekday,
                    dayOfMonth,
                    dayRunCount,
                    dayTimes,
                  })}</div>
                  <div className="mt-1 font-mono text-[11px] break-all">
                    Cron: {buildCronSchedule({
                      mode: scheduleMode,
                      intervalValue,
                      minute: minuteOfHour,
                      hour: hourOfDay,
                      weekday,
                      dayOfMonth,
                      dayRunCount,
                      dayTimes,
                    })}
                  </div>
                </div>

                {nextRun && enabled && (
                  <p className="text-xs text-muted-foreground">
                    下次执行: {formatNextRun(nextRun)}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">全局并发</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={maxGlobalConcurrency}
                    onChange={(e) => setMaxGlobalConcurrency(parseInt(e.target.value, 10) || 30)}
                    className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">渠道并发</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={channelConcurrency}
                    onChange={(e) => setChannelConcurrency(parseInt(e.target.value, 10) || 5)}
                    className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">最小间隔</label>
                  <input
                    type="number"
                    min="0"
                    max="60000"
                    step="500"
                    value={minDelayMs}
                    onChange={(e) => setMinDelayMs(parseInt(e.target.value, 10) || 0)}
                    className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">最大间隔</label>
                  <input
                    type="number"
                    min="0"
                    max="60000"
                    step="500"
                    value={maxDelayMs}
                    onChange={(e) => setMaxDelayMs(parseInt(e.target.value, 10) || 0)}
                    className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  保存
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
