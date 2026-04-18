export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export type ReadinessState = 'ready' | 'warn' | 'error' | 'info';

export interface ReadinessCheck {
  id: string;
  label: string;
  state: ReadinessState;
  summary: string;
  detail?: string;
}

export interface RuntimeActivityItem {
  id: string;
  type: 'connect' | 'disconnect' | 'room' | 'identity' | 'auth';
  message: string;
  timestamp: string;
}

export interface NodeReadiness {
  state: ReadinessState;
  summary: string;
  recommendedAction: string;
  mode: 'connected' | 'local';
  nodeId: string | null;
  operatorEmail: string | null;
  activeModelName: string | null;
  enabledModelsCount: number;
  configuredProvidersCount: number;
  checks: ReadinessCheck[];
  recentActivity: RuntimeActivityItem[];
}

export interface NodeStatus {
  id: string | null;
  name: string;
  operatorName: string;
  operatorEmail: string | null;
  isRunning: boolean;
  uptime: number;
  adaptersCount: number;
  coreConnected: boolean;
  coreConnectionReason: string | null;
  runtimeStatus: string;
  heartbeatIntervalMs: number;
  lastHeartbeatAt: string | null;
  activeRoomsCount: number;
  pendingUsageRecords: number;
}

export interface AdapterConfig {
  type: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface ModelConfig {
  name: string;
  type: string;
  adapter?: string;
  enabled: boolean;
  active: boolean;
  isExported?: boolean;
  agentMode: 'manual' | 'recruitable' | 'autonomous';
  responseMode: 'standard' | 'slow_model';
  model?: string;
  runtimeOnly?: boolean;
}

export interface AgentDescriptor {
  name: string;
  type: string;
  source: 'core' | 'local' | string;
  protocol?: string;
  capabilities?: string[];
  description?: string;
  avatarUrl?: string;
}

export interface Artifact {
  id: string;
  type: 'synthesis' | 'critique' | 'note' | 'data';
  label: string;
  content: string;
  producer: string;
  timestamp: string;
}

export interface RoomTimelineEvent {
  id: string;
  timestamp: string;
  phase?: string;
  envelope: {
    message_type?: string;
    from_agent?: string;
    to_agent?: string;
    scope?: 'room' | 'direct';
    status?: string;
    confidence?: number;
    explanation?: string;
    artifacts?: string[];
    need_human?: boolean;
  };
}

export interface RoomSession {
  roomId: string;
  agentName: string;
  role: string;
  joinedAgentId: string;
  status: 'starting' | 'joined' | 'responding' | 'idle' | 'stopped' | 'error';
  autonomous: boolean;
  lastRespondedAt: number;
  updatedAt: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  task: string;
  subnest: string;
  status: string;
  phase?: string;
  createdAt: string;
  updatedAt: string;
  latestMessageAt?: string;
  latestMessageFrom?: string;
  latestMessageText?: string;
  viewers: number;
}

export interface RoomDetail {
  room: RoomSummary & {
    connectedAgents: Array<{
      id: string;
      name: string;
      owner?: string;
      joinedAt?: string;
      endpointUrl?: string;
    }>;
    settings: {
      pythonShellEnabled: boolean;
      webSearchEnabled?: boolean;
      marketDataEnabled?: boolean;
      webhookUrl?: string;
    };
    timeline: RoomTimelineEvent[];
    artifacts: Artifact[];
    pythonJobs: any[];
    finalOutput?: string;
    agentRoles?: Record<string, string>;
  };
  stats: {
    agents: number;
    totalMessages: number;
    totalShares: number;
    totalViewers: number;
    lastActivity: string;
  } | null;
  brief: any;
  availableAgents: Array<{ name: string; supportedRoles: string[] }>;
  localSessions: RoomSession[];
}

export interface RoomWebhookInfo {
  endpointId: string;
  url: string;
  events: string[];
  signingKey: string;
  signatureHeaders?: {
    timestamp?: string;
    signature?: string;
  };
  verificationOptional?: boolean;
  regeneratePath?: string;
}

export interface RoomWebhookSigningKeyPayload {
  roomWebhook?: RoomWebhookInfo;
  access: 'granted' | 'forbidden' | 'missing';
  message?: string;
}
