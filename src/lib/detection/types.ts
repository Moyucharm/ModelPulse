// Detection system type definitions

import { EndpointType, CheckStatus } from "@/generated/prisma";

export type DetectionTriggerSource = "manual" | "scheduled";

// Endpoint type detection result
export interface EndpointDetection {
  type: EndpointType;
  url: string;
  requestBody: Record<string, unknown>;
  headers: Record<string, string>;
}

// Detection result
export interface DetectionResult {
  status: CheckStatus;
  latency: number;
  statusCode?: number;
  errorMsg?: string;
  endpointType: EndpointType;
  responseContent?: string;
}

// Model info from /v1/models
export interface ModelInfo {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

// Detection job data
export interface DetectionJobData {
  channelId: string;
  channelName: string;
  modelId: string;
  modelName: string;
  checkRunId: string;
  baseUrl: string;
  apiKey: string;
  proxy?: string | null;
  endpointType: EndpointType;
  triggerSource: DetectionTriggerSource;
}

// Channel with models for batch detection
export interface ChannelWithModels {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  proxy: string | null;
  models: {
    id: string;
    modelName: string;
    channelKeyId?: string | null;
  }[];
}

// Result of fetching models from /v1/models
export interface FetchModelsResult {
  models: string[];
  error?: string;
}
