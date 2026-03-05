import prisma from "@/lib/prisma";
import { CheckStatus, HealthStatus } from "@/generated/prisma";
import type { DetectionJobData, DetectionResult } from "./types";
import { SLOW_RESPONSE_THRESHOLD_MS } from "./constants";

interface EndpointStateSnapshot {
  status: CheckStatus;
  latency: number | null;
}

export function deriveModelState(endpointStates: EndpointStateSnapshot[]): {
  healthStatus: HealthStatus;
  lastStatus: boolean | null;
} {
  if (endpointStates.length === 0) {
    return { healthStatus: HealthStatus.UNKNOWN, lastStatus: null };
  }

  const hasSuccess = endpointStates.some((item) => item.status === CheckStatus.SUCCESS);
  const hasFail = endpointStates.some((item) => item.status === CheckStatus.FAIL);
  const hasSlowSuccess = endpointStates.some(
    (item) =>
      item.status === CheckStatus.SUCCESS
      && item.latency !== null
      && item.latency > SLOW_RESPONSE_THRESHOLD_MS
  );

  if (hasSuccess && (hasFail || hasSlowSuccess)) {
    return { healthStatus: HealthStatus.PARTIAL, lastStatus: true };
  }

  if (hasSuccess) {
    return { healthStatus: HealthStatus.HEALTHY, lastStatus: true };
  }

  return { healthStatus: HealthStatus.UNHEALTHY, lastStatus: false };
}

export async function resetModelsDetectionState(modelIds: string[]): Promise<void> {
  if (modelIds.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.modelEndpoint.deleteMany({
      where: { modelId: { in: modelIds } },
    });

    await tx.model.updateMany({
      where: { id: { in: modelIds } },
      data: {
        healthStatus: HealthStatus.UNKNOWN,
        lastStatus: null,
        lastLatency: null,
        lastCheckedAt: null,
      },
    });
  });
}

export async function persistDetectionResult(
  data: DetectionJobData,
  result: DetectionResult
): Promise<void> {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.modelEndpoint.upsert({
      where: {
        modelId_endpointType: {
          modelId: data.modelId,
          endpointType: data.endpointType,
        },
      },
      update: {
        status: result.status,
        latency: result.latency,
        statusCode: result.statusCode ?? null,
        errorMsg: result.errorMsg ?? null,
        responseContent: result.responseContent ?? null,
        checkedAt: now,
      },
      create: {
        modelId: data.modelId,
        endpointType: data.endpointType,
        status: result.status,
        latency: result.latency,
        statusCode: result.statusCode ?? null,
        errorMsg: result.errorMsg ?? null,
        responseContent: result.responseContent ?? null,
        checkedAt: now,
      },
    });

    await tx.checkLog.create({
      data: {
        modelId: data.modelId,
        checkRunId: data.checkRunId,
        endpointType: result.endpointType,
        status: result.status,
        latency: result.latency,
        statusCode: result.statusCode ?? null,
        errorMsg: result.errorMsg ?? null,
        responseContent: result.responseContent ?? null,
      },
    });

    const endpointStates = await tx.modelEndpoint.findMany({
      where: { modelId: data.modelId },
      select: { status: true, latency: true },
    });

    const { healthStatus, lastStatus } = deriveModelState(endpointStates);

    await tx.model.update({
      where: { id: data.modelId },
      data: {
        healthStatus,
        lastStatus,
        lastLatency: result.latency,
        lastCheckedAt: now,
      },
    });
  });
}
