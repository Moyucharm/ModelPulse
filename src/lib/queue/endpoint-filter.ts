import { EndpointType } from "@/generated/prisma";
import { getEndpointsToTest } from "@/lib/detection";

export interface CliDetectionSwitches {
  enableGeminiCliDetection?: boolean;
  enableCodexDetection?: boolean;
  enableClaudeDetection?: boolean;
}

function isEnabled(flag: boolean | undefined): boolean {
  return flag !== false;
}

export function filterEndpointsByCliDetectionSwitches(
  endpoints: EndpointType[],
  switches: CliDetectionSwitches
): EndpointType[] {
  return endpoints.filter((endpointType) => {
    if (endpointType === EndpointType.GEMINI) {
      return isEnabled(switches.enableGeminiCliDetection);
    }
    if (endpointType === EndpointType.CODEX) {
      return isEnabled(switches.enableCodexDetection);
    }
    if (endpointType === EndpointType.CLAUDE) {
      return isEnabled(switches.enableClaudeDetection);
    }
    return true;
  });
}

export function getEndpointsToTestWithCliSwitches(
  model: { modelName: string } & CliDetectionSwitches
): EndpointType[] {
  const endpoints = getEndpointsToTest(model.modelName);
  return filterEndpointsByCliDetectionSwitches(endpoints, model);
}
