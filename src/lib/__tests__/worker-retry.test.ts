import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectionJobData, DetectionResult } from "@/lib/detection/types";

const mockFindUnique = vi.hoisted(() => vi.fn());
const mockExecuteDetection = vi.hoisted(() => vi.fn());
const mockSleep = vi.hoisted(() => vi.fn(async () => {}));
const mockRandomDelay = vi.hoisted(() => vi.fn(() => 0));
const mockPersistDetectionResult = vi.hoisted(() => vi.fn(async () => {}));
const mockHandleScheduledModelCompletion = vi.hoisted(() => vi.fn(async () => {}));
const mockPublishProgress = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/prisma", () => ({
  default: {
    schedulerConfig: {
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock("@/lib/redis", () => ({
  createRedisDuplicate: vi.fn(),
  getRedisClient: vi.fn(),
  isRedisConfigured: false,
}));

vi.mock("@/lib/detection/detector", () => ({
  executeDetection: mockExecuteDetection,
  sleep: mockSleep,
  randomDelay: mockRandomDelay,
}));

vi.mock("@/lib/detection/model-state", () => ({
  persistDetectionResult: mockPersistDetectionResult,
}));

vi.mock("@/lib/notifications/service", () => ({
  handleScheduledModelCompletion: mockHandleScheduledModelCompletion,
}));

vi.mock("@/lib/queue/progress-bus", () => ({
  publishProgress: mockPublishProgress,
}));

import { clearQueue, clearStoppedFlag, addDetectionJob } from "@/lib/queue/queue";
import { reloadWorkerConfig, startWorker, stopWorker } from "@/lib/queue/worker";

function createJob(triggerSource: DetectionJobData["triggerSource"] = "manual"): DetectionJobData {
  return {
    channelId: "channel-1",
    channelName: "Test Channel",
    modelId: "model-1",
    modelName: "gpt-test",
    checkRunId: "run-1",
    baseUrl: "https://example.com",
    apiKey: "test-key",
    proxy: null,
    endpointType: "CHAT",
    triggerSource,
  };
}

function createResult(status: DetectionResult["status"], errorMsg?: string): DetectionResult {
  return {
    status,
    latency: status === "SUCCESS" ? 321 : 0,
    endpointType: "CHAT",
    ...(errorMsg ? { errorMsg } : {}),
  };
}

async function waitForCalls(mockFn: ReturnType<typeof vi.fn>, count: number, timeoutMs: number = 1500): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (mockFn.mock.calls.length >= count) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for ${count} calls, got ${mockFn.mock.calls.length}`);
}

beforeEach(async () => {
  vi.clearAllMocks();

  mockFindUnique.mockResolvedValue({
    channelConcurrency: 5,
    maxGlobalConcurrency: 30,
    minDelayMs: 0,
    maxDelayMs: 0,
    maxAttempts: 3,
  });

  await stopWorker();
  await clearQueue();
  await clearStoppedFlag();
  reloadWorkerConfig();
});

afterEach(async () => {
  await stopWorker();
  await clearQueue();
  await clearStoppedFlag();
  reloadWorkerConfig();
});

describe("worker retry flow", () => {
  it("retries failed jobs and only persists the final success once", async () => {
    mockExecuteDetection
      .mockResolvedValueOnce(createResult("FAIL", "temporary timeout"))
      .mockResolvedValueOnce(createResult("SUCCESS"));

    await addDetectionJob(createJob("manual"));
    startWorker();

    await waitForCalls(mockPersistDetectionResult, 1);

    expect(mockExecuteDetection).toHaveBeenCalledTimes(2);
    expect(mockPersistDetectionResult).toHaveBeenCalledTimes(1);
    expect(mockPersistDetectionResult).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "model-1", triggerSource: "manual" }),
      createResult("SUCCESS")
    );
    expect(mockPublishProgress).toHaveBeenCalledTimes(1);
    expect(mockPublishProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "model-1",
        status: "SUCCESS",
        isModelComplete: true,
      })
    );
    expect(mockHandleScheduledModelCompletion).not.toHaveBeenCalled();
  });

  it("marks scheduled jobs as failed only after exhausting all attempts", async () => {
    const failure = createResult("FAIL", "upstream unavailable");
    mockExecuteDetection.mockResolvedValue(failure);

    await addDetectionJob(createJob("scheduled"));
    startWorker();

    await waitForCalls(mockPersistDetectionResult, 1);

    expect(mockExecuteDetection).toHaveBeenCalledTimes(3);
    expect(mockPersistDetectionResult).toHaveBeenCalledTimes(1);
    expect(mockPersistDetectionResult).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "model-1", triggerSource: "scheduled" }),
      failure
    );
    expect(mockPublishProgress).toHaveBeenCalledTimes(1);
    expect(mockPublishProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "model-1",
        status: "FAIL",
        isModelComplete: true,
      })
    );
    expect(mockHandleScheduledModelCompletion).toHaveBeenCalledTimes(1);
    expect(mockHandleScheduledModelCompletion).toHaveBeenCalledWith("model-1");
  });
});
