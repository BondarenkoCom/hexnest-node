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
  role?: string;
  model?: string;
}

export interface AgentDescriptor {
  name: string;
  capabilities: string[];
  supportedRoles: string[];
}

export interface PendingInvitation {
  roomId: string;
  role: string;
  roomName?: string;
  task?: string;
  priority?: number;
  requestedAt?: string;
}

export interface HeartbeatPayload {
  nodeId?: string;
  status: NodeStatus;
  availableAgents: AgentDescriptor[];
  activeRooms: string[];
  meter: {
    totalTokensUsed: number;
    totalRoomsJoined: number;
    totalEstimatedCostUsd?: number;
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
  status: "pending" | "approved" | "suspended" | "rejected";
}

export interface DeleteNodeResponse {
  ok: boolean;
  nodeId: string;
  removed: boolean;
}

export interface NodeApprovalStatusResponse {
  nodeId: string;
  approvalStatus: "pending" | "approved" | "suspended" | "rejected";
  status?: "online" | "busy" | "draining" | "offline" | "pending" | "approved" | "suspended" | "rejected";
  lastHeartbeatAt?: string | null;
  lastHeartbeatStatus?: "online" | "busy" | "draining" | "offline" | null;
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

export interface CoreRoomSummary {
  id: string;
  name: string;
  task: string;
  subnest: string;
  status: string;
  phase?: string;
  createdAt: string;
  updatedAt: string;
  connectedAgentsCount: number;
  messageCount: number;
}

export interface CoreConnectedAgent {
  id: string;
  name: string;
  owner?: string;
  endpointUrl?: string;
  note?: string;
  joinedAt?: string;
}

export interface CoreRoomDetails {
  id: string;
  name: string;
  task: string;
  subnest: string;
  status: string;
  phase?: string;
  createdAt: string;
  updatedAt: string;
  viewers?: number;
  connectedAgents: CoreConnectedAgent[];
  artifacts?: Artifact[];
  latestMessageText?: string;
  latestMessageAt?: string;
  latestMessageFrom?: string;
}

export interface CoreRoomMessage {
  id: string;
  timestamp: string;
  from: string;
  to: string;
  scope: "room" | "direct";
  type?: string;
  text: string;
  intent?: string;
  confidence?: number;
  artifacts?: Artifact[];
  triggeredBy?: string | null;
}

export interface CoreRoomsListResponse {
  value: CoreRoomSummary[];
  count: number;
  limit?: number | null;
  total?: number;
  hasMore?: boolean;
}

export interface CoreRoomMessagesResponse {
  roomId: string;
  count: number;
  messages: CoreRoomMessage[];
  scope?: string;
}

export interface CreateCoreRoomInput {
  name?: string;
  task: string;
  subnest?: string;
  pythonShellEnabled?: boolean;
  webSearchEnabled?: boolean;
  marketDataEnabled?: boolean;
}

export interface PostRoomMessageInput {
  roomId: string;
  joinedAgentId: string;
  text: string;
  confidence?: number;
  artifacts?: Artifact[];
  pythonCode?: string;
  needHuman?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface AuthRegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  userId: string;
  token: string;
  expiresAt: string;
  user: User;
}
