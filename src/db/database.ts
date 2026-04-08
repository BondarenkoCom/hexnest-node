import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { resolveRuntimePath } from "../runtime-paths.js";

type SqlRow = unknown[];

export type AgentMode = "manual" | "recruitable" | "autonomous";

export type RoomSessionStatus = "starting" | "joined" | "idle" | "responding" | "stopped" | "error";

export interface NodeIdentity {
  id: string;
  token: string;
  createdAt: number;
  updatedAt: number;
}

export interface AdapterConfig {
  id: string;
  type: string; // ClaudeAdapter, OpenAIAdapter, OllamaAdapter
  apiKey?: string;
  baseUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ModelConfig {
  id: string;
  type: string;
  name: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  roles?: string[];
  capabilities?: string[];
  enabled: boolean;
  agentMode: AgentMode;
  active: boolean; // NEW: only one model can be active per adapter
  createdAt: number;
  updatedAt: number;
}

export interface RoomSessionState {
  roomId: string;
  agentName: string;
  role: string;
  joinedAgentId?: string;
  lastSeenMessageId?: string;
  lastRespondedMessageId?: string;
  lastRespondedAt?: number;
  autonomous: boolean;
  status: RoomSessionStatus;
  createdAt: number;
  updatedAt: number;
}

export class DatabaseService {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private ready: Promise<void>;

  constructor(dbPath: string = ".hexnest.db") {
    this.dbPath = resolveRuntimePath(dbPath);
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    const SQL = await initSqlJs();
    
    // Try to load existing database from disk
    let data: Uint8Array | undefined;
    try {
      const fileData = await fs.readFile(this.dbPath);
      data = new Uint8Array(fileData);
    } catch {
      // File doesn't exist, create new database
    }

    this.db = new SQL.Database(data);
    this.initializeSchema();
    await this.save();
  }

  private initializeSchema(): void {
    if (!this.db) throw new Error("Database not initialized");

    try {
      // Check if tables exist
      const tables = this.db
        .exec("SELECT name FROM sqlite_master WHERE type='table'")
        .map((result) => result.values.flat())[0] || [];

      if (!tables.includes("node_identity")) {
        this.db.run(`
          CREATE TABLE node_identity (
            id TEXT PRIMARY KEY,
            token TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);
      }

      if (!tables.includes("adapter_configs")) {
        this.db.run(`
          CREATE TABLE adapter_configs (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL UNIQUE,
            api_key TEXT,
            base_url TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);
      }

      if (!tables.includes("model_configs")) {
        this.db.run(`
          CREATE TABLE model_configs (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            name TEXT NOT NULL UNIQUE,
            model TEXT NOT NULL,
            base_url TEXT,
            api_key TEXT,
            api_key_env TEXT,
            roles TEXT,
            capabilities TEXT,
            enabled BOOLEAN DEFAULT 1,
            agent_mode TEXT DEFAULT 'recruitable',
            active BOOLEAN DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);
      } else {
        const modelColumns = this.db
          .exec("PRAGMA table_info(model_configs)")
          .map((result) => result.values.map((row) => String(row[1])))[0] || [];
        if (!modelColumns.includes("agent_mode")) {
          this.db.run("ALTER TABLE model_configs ADD COLUMN agent_mode TEXT DEFAULT 'recruitable'");
        }
      }

      if (!tables.includes("node_config")) {
        this.db.run(`
          CREATE TABLE node_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);
      }

      if (!tables.includes("room_sessions")) {
        this.db.run(`
          CREATE TABLE room_sessions (
            room_id TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            role TEXT NOT NULL,
            joined_agent_id TEXT,
            last_seen_message_id TEXT,
            last_responded_message_id TEXT,
            last_responded_at INTEGER,
            autonomous BOOLEAN DEFAULT 0,
            status TEXT DEFAULT 'starting',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (room_id, agent_name)
          )
        `);
      } else {
        const roomSessionColumns = this.db
          .exec("PRAGMA table_info(room_sessions)")
          .map((result) => result.values.map((row) => String(row[1])))[0] || [];
        if (!roomSessionColumns.includes("last_responded_at")) {
          this.db.run("ALTER TABLE room_sessions ADD COLUMN last_responded_at INTEGER");
        }
      }
    } catch (error) {
      console.warn("[db] schema initialization warning:", error instanceof Error ? error.message : error);
    }
  }

  private normalizeAgentMode(value: unknown): AgentMode {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "manual" || normalized === "autonomous") {
      return normalized;
    }
    return "recruitable";
  }

  private normalizeRoomSessionStatus(value: unknown): RoomSessionStatus {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (
      normalized === "starting"
      || normalized === "joined"
      || normalized === "idle"
      || normalized === "responding"
      || normalized === "stopped"
      || normalized === "error"
    ) {
      return normalized;
    }
    return "starting";
  }

  private async save(): Promise<void> {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      await fs.writeFile(this.dbPath, buffer);
    } catch (error) {
      console.warn("[db] save failed:", error instanceof Error ? error.message : error);
    }
  }

  async ensureReady(): Promise<void> {
    await this.ready;
  }

  isReady(): boolean {
    return this.db !== null;
  }

  // Node Identity operations
  getNodeIdentity(): NodeIdentity | null {
    if (!this.db) return null;
    try {
      const results = this.db.exec(
        "SELECT id, token, created_at as createdAt, updated_at as updatedAt FROM node_identity LIMIT 1"
      );
      if (results.length === 0 || results[0].values.length === 0) return null;
      const [id, token, createdAt, updatedAt] = results[0].values[0];
      return { id: String(id), token: String(token), createdAt: Number(createdAt), updatedAt: Number(updatedAt) };
    } catch {
      return null;
    }
  }

  setNodeIdentity(id: string, token: string): NodeIdentity {
    if (!this.db) throw new Error("Database not initialized");
    const now = Date.now();
    const existing = this.getNodeIdentity();

    if (existing) {
      this.db.run("UPDATE node_identity SET id = ?, token = ?, updated_at = ?", [id, token, now]);
    } else {
      this.db.run("INSERT INTO node_identity (id, token, created_at, updated_at) VALUES (?, ?, ?, ?)", [
        id,
        token,
        now,
        now
      ]);
    }

    // Save async without blocking
    void this.save();
    return this.getNodeIdentity()!;
  }

  clearNodeIdentity(): void {
    if (!this.db) throw new Error("Database not initialized");
    this.db.run("DELETE FROM node_identity");
    void this.save();
  }

  // Model Config operations
  getModelConfigs(): ModelConfig[] {
    if (!this.db) return [];
    try {
      const results = this.db.exec(`
        SELECT 
          id, type, name, model, base_url, api_key, 
          api_key_env, roles, capabilities, enabled, agent_mode, active,
          created_at, updated_at
        FROM model_configs
        ORDER BY created_at ASC
      `);

      if (results.length === 0) return [];
      
      // sql.js returns: [{columns: [...], values: [[row1], [row2], ...]}]
      const rows = results[0].values;
      if (!rows || rows.length === 0) return [];

      console.log('[MODELS] Found', rows.length, 'model configs');
      
      return rows.map((row: SqlRow) => {
        const [id, type, name, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, active, createdAt, updatedAt] = row;
        return {
          id: String(id),
          type: String(type),
          name: String(name),
          model: String(model),
          baseUrl: baseUrl ? String(baseUrl) : undefined,
          apiKey: apiKey ? String(apiKey) : undefined,
          apiKeyEnv: apiKeyEnv ? String(apiKeyEnv) : undefined,
          roles: roles ? JSON.parse(String(roles)) : undefined,
          capabilities: capabilities ? JSON.parse(String(capabilities)) : undefined,
          enabled: Boolean(enabled),
          agentMode: this.normalizeAgentMode(agentMode),
          active: Boolean(active),
          createdAt: Number(createdAt),
          updatedAt: Number(updatedAt)
        };
      });
    } catch (err) {
      console.error('[MODELS ERROR]', err);
      return [];
    }
  }

  getModelConfig(name: string): ModelConfig | null {
    if (!this.db) return null;
    try {
      const results = this.db.exec(
        `
        SELECT 
          id, type, name, model, base_url, api_key,
          api_key_env, roles, capabilities, enabled, agent_mode, active,
          created_at, updated_at
        FROM model_configs
        WHERE name = ?
      `,
        [name]
      );

      if (results.length === 0 || results[0].values.length === 0) return null;

      const [id, type, modelName, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, active, createdAt, updatedAt] =
        results[0].values[0];
      return {
        id: String(id),
        type: String(type),
        name: String(modelName),
        model: String(model),
        baseUrl: baseUrl ? String(baseUrl) : undefined,
        apiKey: apiKey ? String(apiKey) : undefined,
        apiKeyEnv: apiKeyEnv ? String(apiKeyEnv) : undefined,
        roles: roles ? JSON.parse(String(roles)) : undefined,
        capabilities: capabilities ? JSON.parse(String(capabilities)) : undefined,
        enabled: Boolean(enabled),
        agentMode: this.normalizeAgentMode(agentMode),
        active: Boolean(active),
        createdAt: Number(createdAt),
        updatedAt: Number(updatedAt)
      };
    } catch {
      return null;
    }
  }

  addModelConfig(config: Omit<ModelConfig, "createdAt" | "updatedAt">): ModelConfig {
    if (!this.db) throw new Error("Database not initialized");
    const now = Date.now();
    const id = config.id;
    this.db.run(
      `
        INSERT INTO model_configs 
        (id, type, name, model, base_url, api_key, api_key_env, roles, capabilities, enabled, agent_mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        config.type,
        config.name,
        config.model,
        config.baseUrl ?? null,
        config.apiKey ?? null,
        config.apiKeyEnv ?? null,
        config.roles ? JSON.stringify(config.roles) : null,
        config.capabilities ? JSON.stringify(config.capabilities) : null,
        config.enabled ? 1 : 0,
        this.normalizeAgentMode(config.agentMode),
        now,
        now
      ]
    );

    void this.save();
    return this.getModelConfig(config.name)!;
  }

  updateModelConfig(name: string, updates: Partial<Omit<ModelConfig, "id" | "createdAt" | "updatedAt">>): ModelConfig | null {
    if (!this.db) return null;
    const now = Date.now();
    const existing = this.getModelConfig(name);
    if (!existing) return null;

    const merged = { ...existing, ...updates };
    this.db.run(
      `
        UPDATE model_configs
        SET type = ?, model = ?, base_url = ?, api_key = ?, api_key_env = ?, 
          roles = ?, capabilities = ?, enabled = ?, agent_mode = ?, updated_at = ?
        WHERE name = ?
      `,
      [
        merged.type,
        merged.model,
        merged.baseUrl ?? null,
        merged.apiKey ?? null,
        merged.apiKeyEnv ?? null,
        merged.roles ? JSON.stringify(merged.roles) : null,
        merged.capabilities ? JSON.stringify(merged.capabilities) : null,
        merged.enabled ? 1 : 0,
        this.normalizeAgentMode(merged.agentMode),
        now,
        name
      ]
    );

    void this.save();
    return this.getModelConfig(name);
  }

  deleteModelConfig(name: string): boolean {
    if (!this.db) return false;
    try {
      const existing = this.getModelConfig(name);
      if (!existing) return false;
      this.db.run("DELETE FROM model_configs WHERE name = ?", [name]);
      void this.save();
      return true;
    } catch {
      return false;
    }
  }

  getRoomSession(roomId: string, agentName: string): RoomSessionState | null {
    if (!this.db) return null;
    try {
      const results = this.db.exec(
        `
        SELECT room_id, agent_name, role, joined_agent_id, last_seen_message_id,
           last_responded_message_id, last_responded_at, autonomous, status, created_at, updated_at
        FROM room_sessions
        WHERE room_id = ? AND agent_name = ?
      `,
        [roomId, agentName]
      );

      if (results.length === 0 || results[0].values.length === 0) return null;

      const [
        storedRoomId,
        storedAgentName,
        role,
        joinedAgentId,
        lastSeenMessageId,
        lastRespondedMessageId,
        lastRespondedAt,
        autonomous,
        status,
        createdAt,
        updatedAt
      ] = results[0].values[0];

      return {
        roomId: String(storedRoomId),
        agentName: String(storedAgentName),
        role: String(role),
        joinedAgentId: joinedAgentId ? String(joinedAgentId) : undefined,
        lastSeenMessageId: lastSeenMessageId ? String(lastSeenMessageId) : undefined,
        lastRespondedMessageId: lastRespondedMessageId ? String(lastRespondedMessageId) : undefined,
        lastRespondedAt: Number.isFinite(Number(lastRespondedAt)) ? Number(lastRespondedAt) : undefined,
        autonomous: Boolean(autonomous),
        status: this.normalizeRoomSessionStatus(status),
        createdAt: Number(createdAt),
        updatedAt: Number(updatedAt)
      };
    } catch {
      return null;
    }
  }

  listRoomSessions(roomId: string): RoomSessionState[] {
    if (!this.db) return [];
    try {
      const results = this.db.exec(
        `
        SELECT room_id, agent_name, role, joined_agent_id, last_seen_message_id,
           last_responded_message_id, last_responded_at, autonomous, status, created_at, updated_at
        FROM room_sessions
        WHERE room_id = ?
        ORDER BY updated_at DESC, created_at DESC
      `,
        [roomId]
      );

      if (results.length === 0 || results[0].values.length === 0) {
        return [];
      }

      return results[0].values.map((row) => {
        const [
          storedRoomId,
          storedAgentName,
          role,
          joinedAgentId,
          lastSeenMessageId,
          lastRespondedMessageId,
          lastRespondedAt,
          autonomous,
          status,
          createdAt,
          updatedAt
        ] = row;

        return {
          roomId: String(storedRoomId),
          agentName: String(storedAgentName),
          role: String(role),
          joinedAgentId: joinedAgentId ? String(joinedAgentId) : undefined,
          lastSeenMessageId: lastSeenMessageId ? String(lastSeenMessageId) : undefined,
          lastRespondedMessageId: lastRespondedMessageId ? String(lastRespondedMessageId) : undefined,
          lastRespondedAt: Number.isFinite(Number(lastRespondedAt)) ? Number(lastRespondedAt) : undefined,
          autonomous: Boolean(autonomous),
          status: this.normalizeRoomSessionStatus(status),
          createdAt: Number(createdAt),
          updatedAt: Number(updatedAt)
        } satisfies RoomSessionState;
      });
    } catch {
      return [];
    }
  }

  upsertRoomSession(
    state: Omit<RoomSessionState, "createdAt" | "updatedAt"> & { createdAt?: number; updatedAt?: number }
  ): RoomSessionState {
    if (!this.db) throw new Error("Database not initialized");

    const now = Date.now();
    const existing = this.getRoomSession(state.roomId, state.agentName);
    const createdAt = existing?.createdAt ?? state.createdAt ?? now;

    if (existing) {
      this.db.run(
        `
          UPDATE room_sessions
          SET role = ?, joined_agent_id = ?, last_seen_message_id = ?, last_responded_message_id = ?,
              last_responded_at = ?,
              autonomous = ?, status = ?, updated_at = ?
          WHERE room_id = ? AND agent_name = ?
        `,
        [
          state.role,
          state.joinedAgentId ?? null,
          state.lastSeenMessageId ?? null,
          state.lastRespondedMessageId ?? null,
          state.lastRespondedAt ?? null,
          state.autonomous ? 1 : 0,
          this.normalizeRoomSessionStatus(state.status),
          state.updatedAt ?? now,
          state.roomId,
          state.agentName
        ]
      );
    } else {
      this.db.run(
        `
          INSERT INTO room_sessions (
            room_id, agent_name, role, joined_agent_id, last_seen_message_id,
            last_responded_message_id, last_responded_at, autonomous, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          state.roomId,
          state.agentName,
          state.role,
          state.joinedAgentId ?? null,
          state.lastSeenMessageId ?? null,
          state.lastRespondedMessageId ?? null,
          state.lastRespondedAt ?? null,
          state.autonomous ? 1 : 0,
          this.normalizeRoomSessionStatus(state.status),
          createdAt,
          state.updatedAt ?? now
        ]
      );
    }

    void this.save();
    return this.getRoomSession(state.roomId, state.agentName)!;
  }

  deleteRoomSession(roomId: string, agentName: string): boolean {
    if (!this.db) return false;
    try {
      this.db.run("DELETE FROM room_sessions WHERE room_id = ? AND agent_name = ?", [roomId, agentName]);
      void this.save();
      return true;
    } catch {
      return false;
    }
  }

  // Adapter Config operations
  getAdapterConfig(type: string): AdapterConfig | null {
    if (!this.db) return null;
    try {
      const results = this.db.exec(
        `SELECT id, type, api_key, base_url, created_at, updated_at 
         FROM adapter_configs WHERE type = ?`,
        [type]
      );
      if (results.length === 0 || results[0].values.length === 0) return null;
      const [id, adapterType, apiKey, baseUrl, createdAt, updatedAt] = results[0].values[0];
      return {
        id: String(id),
        type: String(adapterType),
        apiKey: apiKey ? String(apiKey) : undefined,
        baseUrl: baseUrl ? String(baseUrl) : undefined,
        createdAt: Number(createdAt),
        updatedAt: Number(updatedAt)
      };
    } catch {
      return null;
    }
  }

  saveAdapterConfig(type: string, apiKey?: string, baseUrl?: string): AdapterConfig {
    if (!this.db) throw new Error("Database not initialized");
    const now = Date.now();
    const existing = this.getAdapterConfig(type);

    if (existing) {
      this.db.run(
        `UPDATE adapter_configs SET api_key = ?, base_url = ?, updated_at = ? WHERE type = ?`,
        [apiKey ?? null, baseUrl ?? null, now, type]
      );
    } else {
      const id = `adapter-${type}-${Date.now()}`;
      this.db.run(
        `INSERT INTO adapter_configs (id, type, api_key, base_url, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, type, apiKey ?? null, baseUrl ?? null, now, now]
      );
    }
    void this.save();
    return this.getAdapterConfig(type)!;
  }

  deleteAdapterConfig(type: string): boolean {
    if (!this.db) return false;
    try {
      this.db.run(`DELETE FROM adapter_configs WHERE type = ?`, [type]);
      void this.save();
      return true;
    } catch (err) {
      console.error(`Error deleting adapter config for ${type}:`, err);
      return false;
    }
  }

  setActiveModel(modelName: string, type: string): boolean {
    if (!this.db) return false;
    try {
      const now = Date.now();
      // Deactivate all other models of the same type
      this.db.run(`UPDATE model_configs SET active = 0, updated_at = ? WHERE type = ?`, [now, type]);
      // Activate the selected model
      this.db.run(`UPDATE model_configs SET active = 1, updated_at = ? WHERE name = ? AND type = ?`, [now, modelName, type]);
      void this.save();
      return true;
    } catch {
      return false;
    }
  }

  getActiveModel(type: string): ModelConfig | null {
    if (!this.db) return null;
    try {
      const results = this.db.exec(
        `SELECT id, type, name, model, base_url, api_key, api_key_env, roles, capabilities, enabled, agent_mode, active, created_at, updated_at 
         FROM model_configs WHERE type = ? AND active = 1 LIMIT 1`,
        [type]
      );
      if (results.length === 0 || results[0].values.length === 0) return null;
      const [id, modelType, name, model, baseUrl, apiKey, apiKeyEnv, roles, capabilities, enabled, agentMode, active, createdAt, updatedAt] = results[0].values[0];
      return {
        id: String(id),
        type: String(modelType),
        name: String(name),
        model: String(model),
        baseUrl: baseUrl ? String(baseUrl) : undefined,
        apiKey: apiKey ? String(apiKey) : undefined,
        apiKeyEnv: apiKeyEnv ? String(apiKeyEnv) : undefined,
        roles: roles ? JSON.parse(String(roles)) : undefined,
        capabilities: capabilities ? JSON.parse(String(capabilities)) : undefined,
        enabled: Boolean(enabled),
        agentMode: this.normalizeAgentMode(agentMode),
        active: Boolean(active),
        createdAt: Number(createdAt),
        updatedAt: Number(updatedAt)
      };
    } catch {
      return null;
    }
  }

  // Node Config operations
  getNodeConfig(key: string): string | null {
    const config = this.getAllNodeConfig();
    return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : null;
  }

  setNodeConfig(key: string, value: string): void {
    if (!this.db) throw new Error("Database not initialized");
    const now = Date.now();
    const existing = this.getNodeConfig(key);

    if (existing !== null) {
      this.db.run("UPDATE node_config SET value = ?, updated_at = ? WHERE \"key\" = ?", [value, now, key]);
    } else {
      this.db.run("INSERT INTO node_config (\"key\", value, updated_at) VALUES (?, ?, ?)", [key, value, now]);
    }

    void this.save();
  }

  getAllNodeConfig(): Record<string, string> {
    if (!this.db) return {};
    try {
      const results = this.db.exec("SELECT \"key\", value FROM node_config WHERE \"key\" IS NOT NULL");
      if (results.length === 0 || results[0].values.length === 0) return {};
      return Object.fromEntries(
        results[0].values
          .filter((row: SqlRow) => row[0] != null)
          .map((row: SqlRow) => [String(row[0]), String(row[1] ?? "")]) as [string, string][]
      );
    } catch {
      return {};
    }
  }

  close(): void {
    if (this.db) {
      void this.save();
      this.db.close();
    }
  }
}
