export interface CliCapabilities {
  gemini: boolean;
  codex: boolean;
  claude: boolean;
}

function normalizeModelName(modelName: string): string {
  return modelName.toLowerCase();
}

export function supportsCodexCli(modelName: string): boolean {
  const name = normalizeModelName(modelName);
  return name.includes("codex") || /gpt-5\.[123]/.test(name);
}

export function supportsClaudeCli(modelName: string): boolean {
  const name = normalizeModelName(modelName);
  return name.includes("claude");
}

export function supportsGeminiCli(modelName: string): boolean {
  const name = normalizeModelName(modelName);
  return name.includes("gemini");
}

export function getCliCapabilities(modelName: string): CliCapabilities {
  return {
    gemini: supportsGeminiCli(modelName),
    codex: supportsCodexCli(modelName),
    claude: supportsClaudeCli(modelName),
  };
}

export function isCodexOnlyModel(modelName: string): boolean {
  const name = normalizeModelName(modelName);
  return name.includes("codex");
}

export function getPreferredCliEndpoint(
  modelName: string
): "CODEX" | "CLAUDE" | "GEMINI" | null {
  if (supportsCodexCli(modelName)) {
    return "CODEX";
  }
  if (supportsClaudeCli(modelName)) {
    return "CLAUDE";
  }
  if (supportsGeminiCli(modelName)) {
    return "GEMINI";
  }
  return null;
}
