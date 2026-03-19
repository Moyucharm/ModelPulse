import { CheckStatus, HealthStatus } from "@/generated/prisma";
import { SLOW_RESPONSE_THRESHOLD_MS } from "@/lib/detection/constants";
import { endpointTypeLabel } from "@/lib/endpoint-types";
import type {
  ModelEndpointSnapshot,
  ModelNotificationSnapshot,
  NotificationEventType,
  NotificationMessage,
} from "./types";

function formatTimestamp(value: Date): string {
  return value.toLocaleString("zh-CN", {
    hour12: false,
  });
}

function describeHealthStatus(healthStatus: HealthStatus): string {
  switch (healthStatus) {
    case HealthStatus.HEALTHY:
      return "正常";
    case HealthStatus.PARTIAL:
      return "部分故障";
    case HealthStatus.UNHEALTHY:
      return "完全故障";
    case HealthStatus.UNKNOWN:
    default:
      return "未知";
  }
}

function describeEndpointStatus(endpoint: ModelEndpointSnapshot): string | null {
  const endpointLabel = endpointTypeLabel(endpoint.endpointType, "compact");

  if (endpoint.status === CheckStatus.FAIL) {
    const reason = endpoint.errorMsg?.trim()
      || (endpoint.statusCode ? `HTTP ${endpoint.statusCode}` : "检测失败");
    return `${endpointLabel}: ${reason}`;
  }

  if (
    endpoint.latency !== null
    && endpoint.latency > SLOW_RESPONSE_THRESHOLD_MS
  ) {
    return `${endpointLabel}: 响应过慢（${endpoint.latency}ms）`;
  }

  return null;
}

export function getNotificationEventType(
  healthStatus: HealthStatus,
  incidentActive: boolean,
): NotificationEventType | null {
  if (healthStatus === HealthStatus.HEALTHY) {
    return incidentActive ? "recovery" : null;
  }

  if (
    healthStatus === HealthStatus.PARTIAL
    || healthStatus === HealthStatus.UNHEALTHY
  ) {
    return incidentActive ? null : "problem";
  }

  return null;
}

export function buildProblemDetails(
  endpoints: ModelEndpointSnapshot[],
): string[] {
  const details = endpoints
    .map(describeEndpointStatus)
    .filter((item): item is string => Boolean(item));

  return details.length > 0 ? details : ["模型检测异常，但未返回可解析的错误详情"];
}

export function buildNotificationMessage(
  eventType: NotificationEventType,
  snapshot: ModelNotificationSnapshot,
): NotificationMessage {
  const header = `${snapshot.channelName} / ${snapshot.modelName}`;
  const timestamp = formatTimestamp(snapshot.occurredAt);

  if (eventType === "problem") {
    const details = buildProblemDetails(snapshot.endpoints);
    return {
      eventType,
      title: `模型异常：${header}`,
      body: [
        "自动检测发现模型异常。",
        `渠道：${snapshot.channelName}`,
        `模型：${snapshot.modelName}`,
        `状态：${describeHealthStatus(snapshot.healthStatus)}`,
        "异常详情：",
        ...details.map((detail) => `- ${detail}`),
        `时间：${timestamp}`,
      ].join("\n"),
      summary: details[0],
    };
  }

  const healthyCount = snapshot.endpoints.filter((endpoint) => (
    endpoint.status === CheckStatus.SUCCESS
    && (
      endpoint.latency === null
      || endpoint.latency <= SLOW_RESPONSE_THRESHOLD_MS
    )
  )).length;

  return {
    eventType,
    title: `模型恢复：${header}`,
    body: [
      "自动检测发现模型已恢复。",
      `渠道：${snapshot.channelName}`,
      `模型：${snapshot.modelName}`,
      `状态：${describeHealthStatus(snapshot.healthStatus)}`,
      `恢复结果：${healthyCount}/${snapshot.endpoints.length} 个端点当前正常`,
      `时间：${timestamp}`,
    ].join("\n"),
    summary: "模型已恢复正常",
  };
}
