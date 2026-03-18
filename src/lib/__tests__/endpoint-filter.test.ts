import { describe, expect, it } from "vitest";
import { resolveChannelDetectionEndpoints } from "@/lib/queue/endpoint-filter";

describe("resolveChannelDetectionEndpoints", () => {
  it("defaults to chat when channel endpoint config is missing", () => {
    expect(resolveChannelDetectionEndpoints(undefined)).toEqual(["CHAT"]);
  });

  it("keeps configured endpoint order", () => {
    expect(resolveChannelDetectionEndpoints(["CHAT", "CLAUDE", "CODEX"])).toEqual([
      "CHAT",
      "CODEX",
      "CLAUDE",
    ]);
  });

  it("normalizes aliases from imports", () => {
    expect(resolveChannelDetectionEndpoints(["responses", "messages", "images"])).toEqual([
      "CODEX",
      "CLAUDE",
      "IMAGE",
    ]);
  });

  it("drops invalid endpoint values and falls back to chat", () => {
    expect(resolveChannelDetectionEndpoints(["foo", "bar"])).toEqual(["CHAT"]);
  });
});
