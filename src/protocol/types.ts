export type NodeStatus = "online" | "busy" | "draining" | "offline";

export interface Artifact {
  id: string;
  type: "synthesis" | "critique" | "note" | "data";
  label: string;
  content: string;
  producer: string;
  timestamp: string;
}

export interface RoomEvent {
  id: string;
  timestamp: string;
  phase: string;
  from: string;
  to: string;
  scope: "room" | "direct";
  text: string;
  confidence?: number;
}

export interface RoomContext {
  roomId: string;
  roomName: string;
  task: string;
  role: string;
  phase: string;
  timeline: RoomEvent[];
  artifacts: Artifact[];
  rules: string;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface UsageRecord {
  id: string;
  roomId: string;
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  recordedAt: string;
}

export interface AgentDescriptor {
  name: string;
  capabilities: string[];
  supportedRoles: string[];
}

export interface PendingInvitation {
  roomId: string;
  role: string;
}

export interface HeartbeatPayload {
  status: NodeStatus;
  availableAgents: AgentDescriptor[];
  activeRooms: string[];
  meter: {
    totalTokensUsed: number;
    totalRoomsJoined: number;
    uptimeSec: number;
    pendingUsageRecords: number;
  };
}

export interface HeartbeatResponse {
  ok: boolean;
  pendingInvitations: PendingInvitation[];
}

export interface RegisterNodeRequest {
  name: string;
  operatorName: string;
  operatorEmail?: string;
  agentCapabilities: string[];
  callbackUrl?: string;
}

export interface RegisterNodeResponse {
  nodeId: string;
  nodeToken: string;
  status: "pending" | "approved";
}

export interface SubmitUsageResponse {
  accepted: number;
  totalOwed: number;
}

export interface JoinRoomResponse {
  joinedAgent: {
    id: string;
    name: string;
  };
  roomId: string;
}
