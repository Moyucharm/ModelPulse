import { describe, expect, it } from "vitest";
import {
  getCliCapabilities,
  getPreferredCliEndpoint,
  isCodexOnlyModel,
  supportsChatEndpoint,
} from "@/lib/detection/cli-capability";

describe("CLI capability detection", () => {
  it("detects Gemini CLI capability", () => {
    const capabilities = getCliCapabilities("gemini-2.5-pro");
    expect(capabilities).toEqual({
      gemini: true,
      codex: false,
      claude: false,
    });
    expect(getPreferredCliEndpoint("gemini-2.5-pro")).toBe("GEMINI");
  });

  it("detects Claude CLI capability", () => {
    const capabilities = getCliCapabilities("claude-3-7-sonnet");
    expect(capabilities).toEqual({
      gemini: false,
      codex: false,
      claude: true,
    });
    expect(getPreferredCliEndpoint("claude-3-7-sonnet")).toBe("CLAUDE");
  });

  it("detects Codex CLI capability", () => {
    const capabilities = getCliCapabilities("codex-mini-latest");
    expect(capabilities).toEqual({
      gemini: false,
      codex: true,
      claude: false,
    });
    expect(getPreferredCliEndpoint("codex-mini-latest")).toBe("CODEX");
    expect(isCodexOnlyModel("codex-mini-latest")).toBe(true);
    expect(supportsChatEndpoint("codex-mini-latest")).toBe(false);
  });

  it("detects gpt-5.1 as codex-capable but not codex-only", () => {
    const capabilities = getCliCapabilities("gpt-5.1");
    expect(capabilities).toEqual({
      gemini: false,
      codex: true,
      claude: false,
    });
    expect(getPreferredCliEndpoint("gpt-5.1")).toBe("CODEX");
    expect(isCodexOnlyModel("gpt-5.1")).toBe(false);
  });

  it("keeps regular chat and image models without CLI capability", () => {
    expect(getCliCapabilities("gpt-4o")).toEqual({
      gemini: false,
      codex: false,
      claude: false,
    });
    expect(getPreferredCliEndpoint("gpt-4o")).toBeNull();
    expect(supportsChatEndpoint("gpt-4o")).toBe(true);

    expect(getCliCapabilities("dall-e-3")).toEqual({
      gemini: false,
      codex: false,
      claude: false,
    });
    expect(getPreferredCliEndpoint("dall-e-3")).toBeNull();
    expect(supportsChatEndpoint("dall-e-3")).toBe(false);
  });
});
