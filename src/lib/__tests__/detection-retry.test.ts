import { describe, expect, it, vi } from "vitest";
import { executeDetectionWithRetry } from "@/lib/detection/retry";
import type { DetectionJobData, DetectionResult } from "@/lib/detection/types";

function createJob(): DetectionJobData {
  return {
    channelId: "channel-1",
    channelName: "Channel 1",
    modelId: "model-1",
    modelName: "gpt-test",
    checkRunId: "run-1",
    baseUrl: "https://example.com",
    apiKey: "test-key",
    proxy: null,
    endpointType: "CHAT",
    triggerSource: "manual",
  };
}

function createResult(status: DetectionResult["status"], errorMsg?: string): DetectionResult {
  return {
    status,
    latency: status === "SUCCESS" ? 1200 : 0,
    endpointType: "CHAT",
    ...(errorMsg ? { errorMsg } : {}),
  };
}

describe("executeDetectionWithRetry", () => {
  it("retries failed detection until one attempt succeeds", async () => {
    const execute = vi
      .fn<() => Promise<DetectionResult>>()
      .mockResolvedValueOnce(createResult("FAIL", "temporary failure"))
      .mockResolvedValueOnce(createResult("SUCCESS"));
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    const result = await executeDetectionWithRetry(createJob(), {
      maxAttempts: 3,
      execute: () => execute(),
      sleep,
      getRetryDelayMs: () => 25,
      buildStoppedResult: () => createResult("FAIL", "Detection stopped by user"),
      buildUnexpectedFailureResult: () => createResult("FAIL", "unexpected"),
      onRetry,
    });

    expect(result).toEqual({
      result: createResult("SUCCESS"),
      attemptsUsed: 2,
      stopped: false,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(25);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("returns final failure only after exhausting max attempts", async () => {
    const execute = vi.fn<() => Promise<DetectionResult>>().mockResolvedValue(createResult("FAIL", "still failing"));
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const result = await executeDetectionWithRetry(createJob(), {
      maxAttempts: 3,
      execute: () => execute(),
      sleep,
      getRetryDelayMs: () => 10,
      buildStoppedResult: () => createResult("FAIL", "Detection stopped by user"),
      buildUnexpectedFailureResult: () => createResult("FAIL", "unexpected"),
    });

    expect(result).toEqual({
      result: createResult("FAIL", "still failing"),
      attemptsUsed: 3,
      stopped: false,
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("converts unexpected thrown errors into retryable failures", async () => {
    const execute = vi
      .fn<() => Promise<DetectionResult>>()
      .mockRejectedValueOnce(new Error("socket closed"))
      .mockResolvedValueOnce(createResult("SUCCESS"));
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const result = await executeDetectionWithRetry(createJob(), {
      maxAttempts: 2,
      execute: () => execute(),
      sleep,
      getRetryDelayMs: () => 5,
      buildStoppedResult: () => createResult("FAIL", "Detection stopped by user"),
      buildUnexpectedFailureResult: (error) => createResult(
        "FAIL",
        error instanceof Error ? error.message : "unexpected"
      ),
    });

    expect(result).toEqual({
      result: createResult("SUCCESS"),
      attemptsUsed: 2,
      stopped: false,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("returns stopped result without executing when detection has been cancelled", async () => {
    const execute = vi.fn<() => Promise<DetectionResult>>();

    const result = await executeDetectionWithRetry(createJob(), {
      maxAttempts: 3,
      execute: () => execute(),
      sleep: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      isStopped: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      buildStoppedResult: () => createResult("FAIL", "Detection stopped by user"),
      buildUnexpectedFailureResult: () => createResult("FAIL", "unexpected"),
    });

    expect(result).toEqual({
      result: createResult("FAIL", "Detection stopped by user"),
      attemptsUsed: 0,
      stopped: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
