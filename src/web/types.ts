export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface NodeStatus {
  id: string | null;
  name: string;
  operatorName: string;
  operatorEmail?: string | null;
  isRunning: boolean;
  uptime: number;
  adaptersCount: number;
  coreConnected: boolean;
  coreConnectionReason: string | null;
  runtimeStatus: "online" | "busy" | "draining" | "offline";
  heartbeatIntervalMs: number;
  lastHeartbeatAt: string | null;
  activeRoomsCount: number;
  pendingUsageRecords: number;
}

export type ReadinessState = "ready" | "warn" | "error" | "info";

export interface ReadinessCheck {
  id: string;
  label: string;
  state: ReadinessState;
  summary: string;
  detail?: string;
}

export interface RuntimeActivityItem {
  type: "info" | "success" | "warn" | "error";
  message: string;
  timestamp: string;
}

export interface NodeReadiness {
  state: ReadinessState;
  summary: string;
  recommendedAction: string;
  mode: "connected" | "local";
  nodeId: string | null;
  operatorEmail: string | null;
  activeModelName: string | null;
  enabledModelsCount: number;
  configuredProvidersCount: number;
  checks: ReadinessCheck[];
  recentActivity: RuntimeActivityItem[];
}

export interface AdapterInfo {
  id: string;
  type: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  type: string;
  model: string;
  baseUrl?: string;
  roles?: string[];
  capabilities?: string[];
  enabled: boolean;
  active: boolean;
}

export interface NodeConfigInfo {
  heartbeatIntervalMs: number;
  approvalPollIntervalMs: number;
  usageFlushIntervalMs: number;
  maxUsageBatch: number;
  shutdownGraceMs: number;
  autoAcceptInvites: boolean;
  httpTimeoutMs: number;
}
