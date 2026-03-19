import { describe, expect, it } from "vitest";
import { parseModelsResponse } from "@/lib/detection/strategies";

describe("parseModelsResponse", () => {
  it("parses standard OpenAI model payloads", () => {
    expect(parseModelsResponse({
      data: [
        { id: "gpt-5.4" },
        { id: "gpt-4.1-mini" },
      ],
    })).toEqual(["gpt-5.4", "gpt-4.1-mini"]);
  });

  it("accepts string arrays from lightweight proxy servers", () => {
    expect(parseModelsResponse({
      models: ["gpt-5.4", "claude-3.7-sonnet"],
    })).toEqual(["gpt-5.4", "claude-3.7-sonnet"]);
  });

  it("extracts common alternate model fields and de-duplicates results", () => {
    expect(parseModelsResponse({
      data: {
        models: [
          { name: "gpt-5.4" },
          { model: "gpt-5.4" },
          { modelName: "gemini-2.5-pro" },
        ],
      },
    })).toEqual(["gpt-5.4", "gemini-2.5-pro"]);
  });
});
