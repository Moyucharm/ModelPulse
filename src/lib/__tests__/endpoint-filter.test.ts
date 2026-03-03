import { describe, expect, it } from "vitest";
import { EndpointType } from "@/generated/prisma";
import { getEndpointsToTestWithCliSwitches } from "@/lib/queue/endpoint-filter";

describe("getEndpointsToTestWithCliSwitches", () => {
  it("keeps chat + gemini for Gemini models when enabled", () => {
    const endpoints = getEndpointsToTestWithCliSwitches({
      modelName: "gemini-2.5-pro",
      enableChatDetection: true,
      enableGeminiCliDetection: true,
      enableCodexDetection: true,
      enableClaudeDetection: true,
    });
    expect(endpoints).toEqual([EndpointType.CHAT, EndpointType.GEMINI]);
  });

  it("removes Gemini endpoint when Gemini switch is off", () => {
    const endpoints = getEndpointsToTestWithCliSwitches({
      modelName: "gemini-2.5-pro",
      enableChatDetection: true,
      enableGeminiCliDetection: false,
      enableCodexDetection: true,
      enableClaudeDetection: true,
    });
    expect(endpoints).toEqual([EndpointType.CHAT]);
  });

  it("removes Claude endpoint when Claude switch is off", () => {
    const endpoints = getEndpointsToTestWithCliSwitches({
      modelName: "claude-3-7-sonnet",
      enableChatDetection: true,
      enableGeminiCliDetection: true,
      enableCodexDetection: true,
      enableClaudeDetection: false,
    });
    expect(endpoints).toEqual([EndpointType.CHAT]);
  });

  it("skips codex-only model when Codex switch is off", () => {
    const endpoints = getEndpointsToTestWithCliSwitches({
      modelName: "codex-mini-latest",
      enableChatDetection: true,
      enableGeminiCliDetection: true,
      enableCodexDetection: false,
      enableClaudeDetection: true,
    });
    expect(endpoints).toEqual([]);
  });

  it("keeps chat for gpt-5.1 when Codex switch is off", () => {
    const endpoints = getEndpointsToTestWithCliSwitches({
      modelName: "gpt-5.1",
      enableChatDetection: true,
      enableGeminiCliDetection: true,
      enableCodexDetection: false,
      enableClaudeDetection: true,
    });
    expect(endpoints).toEqual([EndpointType.CHAT]);
  });

  it("does not affect regular chat or image models", () => {
    const chatEndpoints = getEndpointsToTestWithCliSwitches({
      modelName: "gpt-4o",
      enableChatDetection: true,
      enableGeminiCliDetection: false,
      enableCodexDetection: false,
      enableClaudeDetection: false,
    });
    expect(chatEndpoints).toEqual([EndpointType.CHAT]);

    const imageEndpoints = getEndpointsToTestWithCliSwitches({
      modelName: "dall-e-3",
      enableChatDetection: true,
      enableGeminiCliDetection: false,
      enableCodexDetection: false,
      enableClaudeDetection: false,
    });
    expect(imageEndpoints).toEqual([EndpointType.IMAGE]);
  });

  it("removes chat endpoint when chat switch is off", () => {
    const endpoints = getEndpointsToTestWithCliSwitches({
      modelName: "gpt-4o",
      enableChatDetection: false,
      enableGeminiCliDetection: true,
      enableCodexDetection: true,
      enableClaudeDetection: true,
    });
    expect(endpoints).toEqual([]);
  });

  it("keeps claude endpoint when chat is off and claude is on", () => {
    const endpoints = getEndpointsToTestWithCliSwitches({
      modelName: "claude-3-7-sonnet",
      enableChatDetection: false,
      enableGeminiCliDetection: true,
      enableCodexDetection: true,
      enableClaudeDetection: true,
    });
    expect(endpoints).toEqual([EndpointType.CLAUDE]);
  });
});
