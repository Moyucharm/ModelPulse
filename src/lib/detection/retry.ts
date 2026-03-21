import { CheckStatus } from "@/generated/prisma";
import type { DetectionJobData, DetectionResult } from "./types";

export interface RetryAttemptInfo {
  attempt: number;
  maxAttempts: number;
  result: DetectionResult;
}

export interface RetryEventInfo extends RetryAttemptInfo {
  delayMs: number;
}

export interface ExecuteDetectionWithRetryOptions {
  maxAttempts: number;
  execute: (job: DetectionJobData) => Promise<DetectionResult>;
  sleep: (ms: number) => Promise<void>;
  getRetryDelayMs?: (info: RetryAttemptInfo) => number;
  isStopped?: () => Promise<boolean>;
  buildStoppedResult: () => DetectionResult;
  buildUnexpectedFailureResult: (error: unknown) => DetectionResult;
  onRetry?: (info: RetryEventInfo) => void | Promise<void>;
}

export interface ExecuteDetectionWithRetryResult {
  result: DetectionResult;
  attemptsUsed: number;
  stopped: boolean;
}

export function normalizeMaxAttempts(value: unknown, fallback: number = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : fallback;
}

export function shouldRetryDetectionResult(result: DetectionResult): boolean {
  return result.status === CheckStatus.FAIL && result.errorMsg !== "Detection stopped by user";
}

export async function executeDetectionWithRetry(
  job: DetectionJobData,
  options: ExecuteDetectionWithRetryOptions
): Promise<ExecuteDetectionWithRetryResult> {
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts, 1);
  let attemptsUsed = 0;
  let lastResult: DetectionResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.isStopped && await options.isStopped()) {
      return {
        result: options.buildStoppedResult(),
        attemptsUsed,
        stopped: true,
      };
    }

    attemptsUsed = attempt;

    let result: DetectionResult;
    try {
      result = await options.execute(job);
    } catch (error) {
      result = options.buildUnexpectedFailureResult(error);
    }

    lastResult = result;

    if (!shouldRetryDetectionResult(result) || attempt === maxAttempts) {
      return {
        result,
        attemptsUsed,
        stopped: false,
      };
    }

    const delayMs = Math.max(0, Math.floor(options.getRetryDelayMs?.({ attempt, maxAttempts, result }) ?? 0));

    if (options.onRetry) {
      await options.onRetry({
        attempt,
        maxAttempts,
        result,
        delayMs,
      });
    }

    if (delayMs > 0) {
      await options.sleep(delayMs);
    }
  }

  return {
    result: lastResult ?? options.buildStoppedResult(),
    attemptsUsed,
    stopped: false,
  };
}
