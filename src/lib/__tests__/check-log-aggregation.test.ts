import { describe, expect, it } from "vitest";
import { aggregateCheckLogsByRun, type RawCheckLog } from "@/lib/detection/check-log-aggregation";

function makeLog(overrides: Partial<RawCheckLog>): RawCheckLog {
  return {
    id: overrides.id ?? "log-default",
    checkRunId: overrides.checkRunId ?? null,
    status: overrides.status ?? "FAIL",
    latency: overrides.latency ?? 100,
    statusCode: overrides.statusCode ?? 500,
    endpointType: overrides.endpointType ?? "CHAT",
    responseContent: overrides.responseContent ?? null,
    errorMsg: overrides.errorMsg ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("aggregateCheckLogsByRun", () => {
  it("aggregates same runId with all success into one green point", () => {
    const logs = [
      makeLog({
        id: "a1",
        checkRunId: "run-1",
        status: "SUCCESS",
        endpointType: "CHAT",
        statusCode: 200,
        createdAt: new Date("2026-01-01T00:00:05.000Z"),
      }),
      makeLog({
        id: "a2",
        checkRunId: "run-1",
        status: "SUCCESS",
        endpointType: "GEMINI",
        statusCode: 200,
        createdAt: new Date("2026-01-01T00:00:03.000Z"),
      }),
    ];

    const result = aggregateCheckLogsByRun(logs);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("SUCCESS");
    expect(result[0].details).toHaveLength(2);
  });

  it("aggregates same runId with mixed results into one yellow point", () => {
    const logs = [
      makeLog({
        id: "b1",
        checkRunId: "run-2",
        status: "SUCCESS",
        endpointType: "CHAT",
      }),
      makeLog({
        id: "b2",
        checkRunId: "run-2",
        status: "FAIL",
        endpointType: "GEMINI",
      }),
    ];

    const result = aggregateCheckLogsByRun(logs);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("PARTIAL");
    expect(result[0].details).toHaveLength(2);
  });

  it("aggregates same runId with all failures into one red point", () => {
    const logs = [
      makeLog({
        id: "c1",
        checkRunId: "run-3",
        status: "FAIL",
        endpointType: "CHAT",
      }),
      makeLog({
        id: "c2",
        checkRunId: "run-3",
        status: "FAIL",
        endpointType: "CODEX",
      }),
    ];

    const result = aggregateCheckLogsByRun(logs);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("FAIL");
    expect(result[0].details).toHaveLength(2);
  });

  it("keeps legacy logs with null checkRunId as separate points", () => {
    const logs = [
      makeLog({
        id: "d1",
        checkRunId: null,
        status: "SUCCESS",
        endpointType: "CHAT",
        createdAt: new Date("2026-01-01T02:00:00.000Z"),
      }),
      makeLog({
        id: "d2",
        checkRunId: null,
        status: "FAIL",
        endpointType: "GEMINI",
        createdAt: new Date("2026-01-01T01:00:00.000Z"),
      }),
    ];

    const result = aggregateCheckLogsByRun(logs);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.status)).toEqual(["SUCCESS", "FAIL"]);
  });

  it("keeps consecutive runs separated by different runId", () => {
    const logs = [
      makeLog({
        id: "e1",
        checkRunId: "run-new",
        status: "SUCCESS",
        endpointType: "CHAT",
        createdAt: new Date("2026-01-01T01:00:00.000Z"),
      }),
      makeLog({
        id: "e2",
        checkRunId: "run-old",
        status: "FAIL",
        endpointType: "CHAT",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ];

    const result = aggregateCheckLogsByRun(logs);
    expect(result).toHaveLength(2);
    expect(result[0].runId).toBe("run-new");
    expect(result[1].runId).toBe("run-old");
  });
});
