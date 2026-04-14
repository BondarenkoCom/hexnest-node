export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
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
  id?: string;
  type: "info" | "success" | "warn" | "error" | "connect" | "disconnect" | "room" | "identity" | "auth";
  message: string;
  timestamp: string;
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
  runtimeStatus: string;
  heartbeatIntervalMs: number;
  lastHeartbeatAt: string | null;
  activeRoomsCount: number;
  pendingUsageRecords: number;
}
