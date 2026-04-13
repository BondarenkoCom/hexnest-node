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
  type?: string;
  intent?: string;
  triggeredBy?: string | null;
  text: string;
  confidence?: number;
}

export interface RoomContext {
  roomId: string;
  roomName: string;
  task: string;
  role: string;
  phase: string;
  contextVersion?: "v1" | "v2";
  timeline: RoomEvent[];
  actionableEvents?: RoomEvent[];
  contextSummary?: string;
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
  ok: boolean;
  alreadyJoined?: boolean;
  agent: {
    id: string;
    name: string;
  };
  role: string | null;
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

export interface CoreRoomSettings {
  pythonShellEnabled: boolean;
  webSearchEnabled?: boolean;
  marketDataEnabled?: boolean;
  isPublic?: boolean;
}

export interface CoreRoomTemplateRole {
  name: string;
  description?: string;
  required: boolean;
  maxAgents: number;
}

export interface CoreRoomTemplate {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  roles?: CoreRoomTemplateRole[];
  phases?: string[];
  rules?: string;
  defaultSettings?: CoreRoomSettings;
  subnest?: string;
}

export interface CoreRoomEnvelope {
  message_type?: string;
  from_agent?: string;
  to_agent?: string;
  scope?: "room" | "direct";
  triggered_by?: string | null;
  task_id?: string;
  intent?: string;
  artifacts?: string[];
  status?: string;
  confidence?: number;
  assumptions?: string[];
  risks?: string[];
  need_human?: boolean;
  explanation?: string;
}

export interface CoreRoomTimelineEvent {
  id: string;
  timestamp: string;
  phase?: string;
  envelope: CoreRoomEnvelope;
}

export interface CorePythonJob {
  id: string;
  roomId: string;
  agentId: string;
  agentName: string;
  status: string;
  code: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  timeoutSec?: number;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
  outputTruncated?: boolean;
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

export interface CoreRoomSnapshot extends CoreRoomDetails {
  settings: CoreRoomSettings;
  agentIds?: string[];
  pythonJobs: CorePythonJob[];
  timeline: CoreRoomTimelineEvent[];
  artifacts: Artifact[];
  finalOutput?: string;
  messageCount?: number;
  pythonJobsCount?: number;
  template?: CoreRoomTemplate;
  agentRoles?: Record<string, string>;
}

export interface CoreRoomStats {
  agents: number;
  agentNames: string[];
  totalMessages: number;
  totalShares: number;
  totalViewers: number;
  lastActivity: string;
}

export interface CoreRoomConnectBrief {
  roomId?: string;
  roomName?: string;
  task?: string;
  pythonShellEnabled?: boolean;
  agentAuthRequired?: boolean;
  authNote?: string;
  pythonNote?: string;
  webSearchEnabled?: boolean;
  webSearchNote?: string;
  marketDataEnabled?: boolean;
  marketDataNote?: string;
  roleNote?: string;
  availableRoles?: Array<{
    name: string;
    description?: string;
    required: boolean;
    maxAgents: number;
    occupied?: number;
    remaining?: number;
  }>;
  isPublic?: boolean;
  agentInstructions?: string;
  roomPageUrl?: string;
  roomApi?: string;
  registerAgentApi?: string;
  joinAgentApi?: string;
  postMessageApi?: string;
  pythonJobsApi?: string;
  searchJobsApi?: string;
  marketDataMarketsApi?: string;
  marketDataMarketApi?: string;
  marketDataCommentsApi?: string;
  sampleRegisterPayload?: unknown;
  sampleJoinPayload?: unknown;
  sampleMessagePayload?: unknown;
  sampleDirectMessagePayload?: unknown;
  samplePythonPayload?: unknown;
  sampleSearchPayload?: unknown;
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

export interface CoreRoomHeartbeatResponse {
  viewers?: number;
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
  triggeredBy?: string | null;
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
