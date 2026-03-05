import { describe, expect, it } from "vitest";
import { deriveModelState } from "@/lib/detection/model-state";

describe("deriveModelState", () => {
  it("returns unknown when no endpoint states exist", () => {
    const result = deriveModelState([]);
    expect(result).toEqual({
      healthStatus: "UNKNOWN",
      lastStatus: null,
    });
  });

  it("returns healthy for all fast successes", () => {
    const result = deriveModelState([
      { status: "SUCCESS", latency: 1200 },
      { status: "SUCCESS", latency: 29000 },
    ]);

    expect(result).toEqual({
      healthStatus: "HEALTHY",
      lastStatus: true,
    });
  });

  it("returns partial when a success is slower than 30 seconds", () => {
    const result = deriveModelState([
      { status: "SUCCESS", latency: 31001 },
      { status: "SUCCESS", latency: 1500 },
    ]);

    expect(result).toEqual({
      healthStatus: "PARTIAL",
      lastStatus: true,
    });
  });

  it("returns partial for mixed success and failure endpoints", () => {
    const result = deriveModelState([
      { status: "SUCCESS", latency: 2000 },
      { status: "FAIL", latency: 61000 },
    ]);

    expect(result).toEqual({
      healthStatus: "PARTIAL",
      lastStatus: true,
    });
  });

  it("returns unhealthy when all endpoints fail", () => {
    const result = deriveModelState([
      { status: "FAIL", latency: 61000 },
      { status: "FAIL", latency: 2000 },
    ]);

    expect(result).toEqual({
      healthStatus: "UNHEALTHY",
      lastStatus: false,
    });
  });
});
