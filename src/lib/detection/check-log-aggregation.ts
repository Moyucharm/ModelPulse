import { CheckStatus, EndpointType } from "@/generated/prisma";
import { SLOW_RESPONSE_THRESHOLD_MS } from "./constants";

export type AggregatedCheckStatus = CheckStatus | "PARTIAL";

export interface RawCheckLog {
  id: string;
  checkRunId: string | null;
  status: CheckStatus;
  latency: number | null;
  statusCode: number | null;
  endpointType: EndpointType;
  responseContent: string | null;
  errorMsg: string | null;
  createdAt: Date;
}

export interface AggregatedCheckLogDetail {
  endpointType: EndpointType;
  status: CheckStatus;
  latency: number | null;
  statusCode: number | null;
  responseContent: string | null;
  errorMsg: string | null;
  createdAt: Date;
}

export interface AggregatedCheckLogEntry {
  runId: string | null;
  status: AggregatedCheckStatus;
  latency: number | null;
  createdAt: Date;
  details: AggregatedCheckLogDetail[];
}

interface CheckLogGroup {
  runId: string | null;
  latestAtMs: number;
  latestCreatedAt: Date;
  latestLatency: number | null;
  details: AggregatedCheckLogDetail[];
}

function deriveAggregatedStatus(
  details: Array<Pick<AggregatedCheckLogDetail, "status" | "latency">>
): AggregatedCheckStatus {
  const hasSuccess = details.some((detail) => detail.status === CheckStatus.SUCCESS);
  const hasFail = details.some((detail) => detail.status === CheckStatus.FAIL);
  const hasSlowSuccess = details.some(
    (detail) =>
      detail.status === CheckStatus.SUCCESS
      && detail.latency !== null
      && detail.latency > SLOW_RESPONSE_THRESHOLD_MS
  );

  if (hasSuccess && (hasFail || hasSlowSuccess)) return "PARTIAL";
  if (hasSuccess) return CheckStatus.SUCCESS;
  return CheckStatus.FAIL;
}

function toTimestamp(date: Date): number {
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function aggregateCheckLogsByRun(
  logs: RawCheckLog[],
  points: number = 24
): AggregatedCheckLogEntry[] {
  if (logs.length === 0 || points <= 0) {
    return [];
  }

  const groups = new Map<string, CheckLogGroup>();

  for (const log of logs) {
    const groupKey = log.checkRunId ?? `legacy:${log.id}`;
    const createdAtMs = toTimestamp(log.createdAt);

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        runId: log.checkRunId ?? null,
        latestAtMs: createdAtMs,
        latestCreatedAt: log.createdAt,
        latestLatency: log.latency,
        details: [],
      };
      groups.set(groupKey, group);
    }

    group.details.push({
      endpointType: log.endpointType,
      status: log.status,
      latency: log.latency,
      statusCode: log.statusCode,
      responseContent: log.responseContent,
      errorMsg: log.errorMsg,
      createdAt: log.createdAt,
    });

    if (createdAtMs > group.latestAtMs) {
      group.latestAtMs = createdAtMs;
      group.latestCreatedAt = log.createdAt;
      group.latestLatency = log.latency;
    }
  }

  return Array.from(groups.values())
    .map((group) => {
      group.details.sort((a, b) => {
        const timeDiff = toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
        if (timeDiff !== 0) return timeDiff;
        return a.endpointType.localeCompare(b.endpointType);
      });

      return {
        runId: group.runId,
        status: deriveAggregatedStatus(group.details),
        latency: group.latestLatency,
        createdAt: group.latestCreatedAt,
        details: group.details,
      };
    })
    .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt))
    .slice(0, points);
}
