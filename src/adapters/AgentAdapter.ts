import { CostEstimate, RoomContext } from "../protocol/types.js";

export interface AgentResponse {
  text: string;
  confidence: number;
  artifacts?: {
    id: string;
    type: "synthesis" | "critique" | "note" | "data";
    label: string;
    content: string;
    producer: string;
    timestamp: string;
  }[];
  pythonCode?: string;
  needHuman?: boolean;
}

export interface AgentAdapter {
  name: string;
  capabilities: string[];
  supportedRoles: string[];
  respond(context: RoomContext): Promise<AgentResponse>;
  estimateCost(context: RoomContext, responseText?: string): Promise<CostEstimate>;
}
