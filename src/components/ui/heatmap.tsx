// Availability history dots (24 points by default).

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/toast";
import { endpointTypeLabel, type ChannelEndpointType } from "@/lib/endpoint-types";
import { cn } from "@/lib/utils";

interface HeatmapEntry {
  status: "SUCCESS" | "PARTIAL" | "FAIL";
  runId?: string | null;
  createdAt: string;
  endpointType?: string;
  latency?: number | null;
  statusCode?: number | null;
  errorMsg?: string | null;
  responseContent?: string | null;
  details?: HeatmapDetail[];
}

interface HeatmapDetail {
  endpointType: string;
  status: "SUCCESS" | "FAIL";
  latency: number | null;
  statusCode: number | null;
  errorMsg: string | null;
  responseContent: string | null;
  createdAt: string;
}

interface HeatmapProps {
  data: HeatmapEntry[];
  className?: string;
  points?: number;
}

interface DotTooltipData {
  headerLine: string;
  detailLines: string[];
  copyText: string;
}

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ActiveTooltipState {
  index: number;
  anchorRect: AnchorRect;
}

interface DotViewItem {
  key: string;
  hasData: boolean;
  statusClass: string;
  glowClass: string;
  tooltipData: DotTooltipData | null;
  ariaLabel: string;
}

const TOOLTIP_HORIZONTAL_MARGIN = 8;
const TOOLTIP_MAX_WIDTH = 360;
const TOOLTIP_MIN_WIDTH = 220;
const TOOLTIP_VERTICAL_OFFSET = 10;
const TOOLTIP_CLOSE_DELAY_MS = 120;
const TOOLTIP_MIN_TOP_SPACE = 220;

function formatEndpointLabel(endpointType?: string): string {
  if (!endpointType) return "Unknown";
  return endpointTypeLabel(endpointType as ChannelEndpointType, "compact");
}

function normalizeText(source: string | null | undefined): string {
  if (!source) return "";
  return source.replace(/\s+/g, " ").trim();
}

function formatSummaryStatus(status: HeatmapEntry["status"]): string {
  if (status === "SUCCESS") return "全部成功";
  if (status === "PARTIAL") return "部分成功";
  return "全部失败";
}

function normalizeDetails(entry: HeatmapEntry): HeatmapDetail[] {
  if (entry.details && entry.details.length > 0) {
    return entry.details;
  }

  if (!entry.endpointType) {
    return [];
  }

  return [{
    endpointType: entry.endpointType,
    status: entry.status === "SUCCESS" ? "SUCCESS" : "FAIL",
    latency: entry.latency ?? null,
    statusCode: entry.statusCode ?? null,
    errorMsg: entry.errorMsg ?? null,
    responseContent: entry.responseContent ?? null,
    createdAt: entry.createdAt,
  }];
}

function buildTooltipData(entry: HeatmapEntry): DotTooltipData | null {
  if (!entry.createdAt) return null;

  const details = normalizeDetails(entry);
  const detailLines = details.map((detailEntry) => {
    const endpointLabel = formatEndpointLabel(detailEntry.endpointType);
    const statusCodeLabel = detailEntry.statusCode ? ` | HTTP ${detailEntry.statusCode}` : "";
    const latencyLabel = detailEntry.latency !== null ? ` | ${detailEntry.latency}ms` : "";
    const detailText = normalizeText(detailEntry.errorMsg || detailEntry.responseContent);
    return `${endpointLabel} | ${detailEntry.status}${statusCodeLabel}${latencyLabel}${detailText ? ` | ${detailText}` : ""}`;
  });

  if (detailLines.length === 0) {
    const endpointLabel = formatEndpointLabel(entry.endpointType);
    const statusCodeLabel = entry.statusCode ? ` | HTTP ${entry.statusCode}` : "";
    const latencyLabel = entry.latency !== null ? ` | ${entry.latency}ms` : "";
    const detailText = normalizeText(entry.errorMsg || entry.responseContent);
    detailLines.push(`${endpointLabel} | ${entry.status}${statusCodeLabel}${latencyLabel}${detailText ? ` | ${detailText}` : ""}`);
  }

  const headerLine = `${new Date(entry.createdAt).toLocaleString()} | ${formatSummaryStatus(entry.status)}`;
  const copyText = [headerLine, ...detailLines].join("\n");

  return {
    headerLine,
    detailLines,
    copyText,
  };
}

function getAnchorRect(element: HTMLElement): AnchorRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function Heatmap({ data, className, points = 24 }: HeatmapProps) {
  const { toast } = useToast();
  const dotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<ActiveTooltipState | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
      if (closeTooltipTimerRef.current) {
        clearTimeout(closeTooltipTimerRef.current);
      }
    };
  }, []);

  const entries = useMemo(() => {
    const nextEntries = data.slice(0, points).reverse();

    while (nextEntries.length < points) {
      nextEntries.unshift({
        status: "FAIL",
        createdAt: "",
      } as HeatmapEntry);
    }

    return nextEntries;
  }, [data, points]);

  const dotItems = useMemo<DotViewItem[]>(() => {
    return entries.map((entry, index) => {
      const hasData = entry.createdAt !== "";
      const tooltipData = hasData ? buildTooltipData(entry) : null;

      let statusClass = "bg-rose-500";
      let glowClass = "shadow-[0_0_0_2px_rgba(244,63,94,0.2)]";
      if (entry.status === "SUCCESS") {
        statusClass = "bg-emerald-500";
        glowClass = "shadow-[0_0_0_2px_rgba(16,185,129,0.24)]";
      } else if (entry.status === "PARTIAL") {
        statusClass = "bg-amber-500";
        glowClass = "shadow-[0_0_0_2px_rgba(245,158,11,0.24)]";
      }

      return {
        key: `${entry.createdAt || "empty"}-${index}`,
        hasData,
        statusClass,
        glowClass,
        tooltipData,
        ariaLabel: tooltipData
          ? `${tooltipData.headerLine}，按回车或空格可复制详情`
          : "暂无数据",
      };
    });
  }, [entries]);

  useEffect(() => {
    if (!activeTooltip) return;
    if (!dotItems[activeTooltip.index]?.hasData) return;

    const updateTooltipAnchor = () => {
      const node = dotRefs.current[activeTooltip.index];
      if (!node) {
        setActiveTooltip(null);
        return;
      }
      setActiveTooltip((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          anchorRect: getAnchorRect(node),
        };
      });
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveTooltip(null);
      }
    };

    window.addEventListener("resize", updateTooltipAnchor);
    window.addEventListener("scroll", updateTooltipAnchor, true);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("resize", updateTooltipAnchor);
      window.removeEventListener("scroll", updateTooltipAnchor, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [activeTooltip, dotItems]);

  const clearTooltipCloseTimer = () => {
    if (closeTooltipTimerRef.current) {
      clearTimeout(closeTooltipTimerRef.current);
      closeTooltipTimerRef.current = null;
    }
  };

  const isInTooltipInteractionArea = (index: number, target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) {
      return false;
    }

    const dot = dotRefs.current[index];
    if (dot?.contains(target)) {
      return true;
    }

    return Boolean(tooltipRef.current?.contains(target));
  };

  const scheduleTooltipClose = (index: number) => {
    clearTooltipCloseTimer();
    closeTooltipTimerRef.current = setTimeout(() => {
      setActiveTooltip((prev) => (prev && prev.index === index ? null : prev));
      closeTooltipTimerRef.current = null;
    }, TOOLTIP_CLOSE_DELAY_MS);
  };

  const openTooltip = (index: number, element: HTMLButtonElement) => {
    clearTooltipCloseTimer();
    setActiveTooltip({
      index,
      anchorRect: getAnchorRect(element),
    });
  };

  const handleDotMouseLeave = (index: number, event: React.MouseEvent<HTMLButtonElement>) => {
    if (isInTooltipInteractionArea(index, event.relatedTarget)) {
      return;
    }
    scheduleTooltipClose(index);
  };

  const handleDotBlur = (index: number, event: React.FocusEvent<HTMLButtonElement>) => {
    if (isInTooltipInteractionArea(index, event.relatedTarget)) {
      return;
    }
    scheduleTooltipClose(index);
  };

  const handleTooltipMouseLeave = (index: number, event: React.MouseEvent<HTMLDivElement>) => {
    if (isInTooltipInteractionArea(index, event.relatedTarget)) {
      return;
    }
    scheduleTooltipClose(index);
  };

  const handleDotClick = async (index: number, item: DotViewItem) => {
    if (!item.tooltipData) return;

    try {
      await navigator.clipboard.writeText(item.tooltipData.copyText);
      setCopiedIndex(index);
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => {
        setCopiedIndex((prev) => (prev === index ? null : prev));
      }, 1500);
      toast("已复制该时间点检测详情", "success");
    } catch {
      toast("复制失败：无法访问剪贴板", "error");
    }
  };

  const activeItem = activeTooltip ? dotItems[activeTooltip.index] : null;
  const tooltipId = activeTooltip ? `heatmap-tooltip-${activeTooltip.index}` : undefined;
  const canRenderTooltip = typeof window !== "undefined";

  const tooltipPortal = canRenderTooltip && activeTooltip && activeItem?.tooltipData
    ? (() => {
        const viewportWidth = window.innerWidth;
        const width = Math.min(
          TOOLTIP_MAX_WIDTH,
          Math.max(TOOLTIP_MIN_WIDTH, viewportWidth - TOOLTIP_HORIZONTAL_MARGIN * 2)
        );
        const anchorCenter = activeTooltip.anchorRect.left + activeTooltip.anchorRect.width / 2;
        const left = Math.min(
          viewportWidth - width - TOOLTIP_HORIZONTAL_MARGIN,
          Math.max(TOOLTIP_HORIZONTAL_MARGIN, anchorCenter - width / 2)
        );
        const renderAbove = activeTooltip.anchorRect.top > TOOLTIP_MIN_TOP_SPACE;
        const top = renderAbove
          ? activeTooltip.anchorRect.top - TOOLTIP_VERTICAL_OFFSET
          : activeTooltip.anchorRect.top + activeTooltip.anchorRect.height + TOOLTIP_VERTICAL_OFFSET;

        return createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            ref={tooltipRef}
            className="fixed z-[60] pointer-events-auto"
            onMouseEnter={clearTooltipCloseTimer}
            onMouseLeave={(event) => handleTooltipMouseLeave(activeTooltip.index, event)}
            style={{
              top,
              left,
              width,
              transform: renderAbove ? "translateY(-100%)" : "translateY(0)",
            }}
          >
            <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur-sm animate-tooltip-pop">
              <div className="max-h-48 overflow-y-auto space-y-1 whitespace-pre-wrap break-words">
                <p className="font-semibold text-[11px] leading-relaxed">
                  {activeItem.tooltipData.headerLine}
                </p>
                {activeItem.tooltipData.detailLines.map((line, lineIndex) => (
                  <p
                    key={`${activeTooltip.index}-${lineIndex}`}
                    className="font-mono text-[11px] leading-relaxed text-muted-foreground"
                  >
                    {line}
                  </p>
                ))}
                <p className="pt-1 text-[10px] text-muted-foreground/80">
                  单击圆点可复制完整详情
                </p>
              </div>
            </div>
          </div>,
          document.body
        );
      })()
    : null;

  return (
    <>
      <div className={cn("flex flex-wrap gap-1", className)}>
        {dotItems.map((item, index) => {
          const isActive = activeTooltip?.index === index;
          const isCopied = copiedIndex === index;

          return (
            <button
              key={item.key}
              type="button"
              ref={(element) => {
                dotRefs.current[index] = element;
              }}
              disabled={!item.hasData}
              aria-label={item.ariaLabel}
              aria-describedby={isActive ? tooltipId : undefined}
              onMouseEnter={(event) => openTooltip(index, event.currentTarget)}
              onMouseLeave={(event) => handleDotMouseLeave(index, event)}
              onFocus={(event) => openTooltip(index, event.currentTarget)}
              onBlur={(event) => handleDotBlur(index, event)}
              onClick={() => void handleDotClick(index, item)}
              className={cn(
                "h-3 w-3 rounded-full transition-transform duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                item.hasData
                  ? cn(
                      item.statusClass,
                      "cursor-pointer hover:scale-[1.4] focus-visible:scale-[1.4] hover:brightness-110 focus-visible:brightness-110",
                      (isActive || isCopied) && item.glowClass
                    )
                  : "bg-muted cursor-default"
              )}
            />
          );
        })}
      </div>
      {tooltipPortal}
    </>
  );
}
