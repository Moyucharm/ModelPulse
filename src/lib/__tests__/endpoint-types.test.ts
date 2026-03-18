import { describe, expect, it } from "vitest";
import {
  endpointTypeLabel,
  hasSameChannelEndpointTypes,
  normalizeChannelEndpointTypes,
} from "@/lib/endpoint-types";

describe("normalizeChannelEndpointTypes", () => {
  it("falls back to chat for missing legacy data", () => {
    expect(normalizeChannelEndpointTypes(undefined)).toEqual(["CHAT"]);
  });

  it("accepts mixed aliases and preserves canonical order", () => {
    expect(normalizeChannelEndpointTypes(["messages", "CHAT", "responses"])).toEqual([
      "CHAT",
      "CODEX",
      "CLAUDE",
    ]);
  });

  it("supports comma separated imports", () => {
    expect(normalizeChannelEndpointTypes("chat,responses,images")).toEqual([
      "CHAT",
      "CODEX",
      "IMAGE",
    ]);
  });
});

describe("endpoint type helpers", () => {
  it("compares endpoint selections by order and value", () => {
    expect(hasSameChannelEndpointTypes(["CHAT", "CLAUDE"], ["CHAT", "CLAUDE"])).toBe(true);
    expect(hasSameChannelEndpointTypes(["CHAT", "CLAUDE"], ["CLAUDE", "CHAT"])).toBe(false);
  });

  it("returns user-facing labels", () => {
    expect(endpointTypeLabel("CHAT")).toBe("OpenAI Chat Completions");
    expect(endpointTypeLabel("CLAUDE", "compact")).toBe("Anthropic Messages");
  });
});
