import { Artifact, CostEstimate, RoomContext } from "../protocol/types.js";

export interface AgentResponse {
  text: string;
  confidence: number;
  artifacts?: Artifact[];
  pythonCode?: string;
  needHuman?: boolean;
}

export interface AgentAdapter {
  name: string;
  modelId?: string;
  capabilities: string[];
  supportedRoles: string[];
  respond(context: RoomContext): Promise<AgentResponse>;
  estimateCost(context: RoomContext, responseText?: string): Promise<CostEstimate>;
}
