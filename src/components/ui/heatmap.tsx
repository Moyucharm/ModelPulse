// Availability history dots (24 points by default).

"use client";

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

function formatEndpointLabel(endpointType?: string): string {
  switch (endpointType) {
    case "CHAT":
      return "Chat";
    case "CLAUDE":
      return "Claude CLI";
    case "GEMINI":
      return "Gemini CLI";
    case "CODEX":
      return "Codex CLI";
    case "IMAGE":
      return "Image";
    default:
      return endpointType || "Unknown";
  }
}

function summarizeMessage(entry: HeatmapEntry): string {
  const source = entry.errorMsg || entry.responseContent || "";
  if (!source) return "";

  const compact = source.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact;
}

function summarizeSource(source: string | null | undefined): string {
  if (!source) return "";
  const compact = source.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact;
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

export function Heatmap({ data, className, points = 24 }: HeatmapProps) {
  const entries = data.slice(0, points).reverse();

  while (entries.length < points) {
    entries.unshift({
      status: "FAIL",
      createdAt: "",
    } as HeatmapEntry);
  }

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {entries.map((entry, index) => {
        const hasData = entry.createdAt !== "";
        const details = normalizeDetails(entry);
        const detailLines = details.map((detailEntry) => {
          const endpointLabel = formatEndpointLabel(detailEntry.endpointType);
          const statusCodeLabel = detailEntry.statusCode ? ` | HTTP ${detailEntry.statusCode}` : "";
          const latencyLabel = detailEntry.latency !== null ? ` | ${detailEntry.latency}ms` : "";
          const detail = summarizeSource(detailEntry.errorMsg || detailEntry.responseContent);
          return `${endpointLabel} | ${detailEntry.status}${statusCodeLabel}${latencyLabel}${detail ? ` | ${detail}` : ""}`;
        });

        if (detailLines.length === 0 && hasData) {
          const endpointLabel = formatEndpointLabel(entry.endpointType);
          const statusCodeLabel = entry.statusCode ? ` | HTTP ${entry.statusCode}` : "";
          const detail = summarizeMessage(entry);
          detailLines.push(`${endpointLabel} | ${entry.status}${statusCodeLabel}${detail ? ` | ${detail}` : ""}`);
        }

        const title = hasData
          ? [
            `${new Date(entry.createdAt).toLocaleString()} | ${formatSummaryStatus(entry.status)}`,
            ...detailLines,
          ].join("\n")
          : "No data";

        let statusClass = "bg-rose-500";
        if (entry.status === "SUCCESS") {
          statusClass = "bg-emerald-500";
        } else if (entry.status === "PARTIAL") {
          statusClass = "bg-amber-500";
        }

        return (
          <div
            key={`${entry.createdAt || "empty"}-${index}`}
            className={cn(
              "h-3 w-3 rounded-full transition-colors",
              hasData
                ? statusClass
                : "bg-muted"
            )}
            title={title}
          />
        );
      })}
    </div>
  );
}
