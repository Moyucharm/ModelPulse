import {
  normalizeChannelEndpointTypes,
  type ChannelEndpointType,
} from "@/lib/endpoint-types";

export function resolveChannelDetectionEndpoints(
  channelEndpointTypes: unknown
): ChannelEndpointType[] {
  return normalizeChannelEndpointTypes(channelEndpointTypes);
}
