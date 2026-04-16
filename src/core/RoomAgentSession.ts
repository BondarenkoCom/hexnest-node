import { AgentAdapter, AgentResponse } from "../adapters/index.js";
import type { RoomCycleOutcome, RoomSessionState, RoomSessionStatus } from "../db/database.js";
import { HexNestClientLike } from "../protocol/HexNestClient.js";
import { CoreRoomMessage, RoomContext } from "../protocol/types.js";
import { evaluateRoomAgentPolicy } from "./RoomAgentPolicy.js";

interface RoomAgentSessionLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface RoomAgentTurn {
  context: RoomContext;
  response: AgentResponse;
  triggeredBy: string | null;
  joinedAgentId: string;
  reason: string;
}

export interface RoomAgentSessionOptions {
  client: HexNestClientLike;
  adapter: AgentAdapter;
  roomId: string;
  role: string;
  taskHint?: string;
  autonomous?: boolean;
  loopGuardEnabled?: boolean;
  maxNoActionStreak?: number;
  pollIntervalMs?: number;
  shouldStop?: () => boolean;
  initialState?: RoomSessionState | null;
  onStateChange?: (state: Omit<RoomSessionState, "createdAt" | "updatedAt">) => Promise<void> | void;
  onTurn?: (turn: RoomAgentTurn) => Promise<void> | void;
  logger?: RoomAgentSessionLogger;
}

const DEFAULT_POLL_MS = 8_000;
const DEFAULT_AUTONOMOUS_COOLDOWN_MS = 15_000;
const DEFAULT_MAX_NO_ACTION_STREAK = 3;

export class RoomAgentSession {
  private joinedAgentId: string | null = null;
  private joinedAgentName: string | null = null;
  private lastSeenMessageId: string | null = null;
  private lastRespondedMessageId: string | null = null;
  private lastRespondedAt: number | null = null;
  private lastRoomFingerprint: string | null = null;
  private lastCycleOutcome: RoomCycleOutcome | null = null;
  private lastNoActionReason: string | null = null;
  private noActionStreak = 0;
  private status: RoomSessionStatus = "starting";

  constructor(private readonly options: RoomAgentSessionOptions) {
    const initial = options.initialState;
    if (initial) {
      this.joinedAgentId = initial.joinedAgentId || null;
      this.lastSeenMessageId = initial.lastSeenMessageId || null;
      this.lastRespondedMessageId = initial.lastRespondedMessageId || null;
      this.lastRespondedAt = initial.lastRespondedAt || null;
      this.lastRoomFingerprint = initial.lastRoomFingerprint || null;
      this.lastCycleOutcome = initial.lastCycleOutcome || null;
      this.lastNoActionReason = initial.lastNoActionReason || null;
      this.noActionStreak = Math.max(0, Number(initial.noActionStreak || 0));
      this.status = initial.status || "starting";
    }
  }

  async run(): Promise<void> {
    await this.emitState("starting");
    try {
      await this.ensureJoined();
      this.lastRespondedAt = Date.now();
      this.options.logger?.info(`[session] Agent ${this.options.adapter.name} is joined and ready in room ${this.options.roomId}`);
      await this.emitState("idle");

      if (this.shouldResumeAutonomousSession()) {
        await this.runAutonomousLoop();
        await this.emitState("stopped");
        return;
      }

      try {
        await this.runInitialTurn();
      } catch (error) {
        if (!this.isRecoverableAdapterError(error)) {
          throw error;
        }
        this.options.logger?.warn(
          `[session] recoverable adapter error during initial turn room=${this.options.roomId} agent=${this.options.adapter.name}; continuing without fatal stop`
        );
        await this.recordNoAction("adapter_recoverable_initial", `initial|${this.options.roomId}`);
      }

      if (!this.options.autonomous) {
        await this.emitState("stopped");
        return;
      }

      await this.runAutonomousLoop();
      await this.emitState("stopped");
    } catch (error: any) {
      const msg = error.message || String(error);
      this.options.logger?.error(`[session] critical failure room=${this.options.roomId} agent=${this.options.adapter.name}: ${msg}`);
      if (msg.includes("401") || error?.status === 401) {
        this.joinedAgentId = null;
        this.joinedAgentName = null;
      }
      await this.emitState("error");
      throw error;
    }
  }

  private async ensureJoined(): Promise<void> {
    if (this.joinedAgentId) {
      return;
    }

    const joined = await this.options.client.joinRoom(
      this.options.roomId,
      this.options.adapter.name,
      this.options.role
    );
    const joinedAny = joined as unknown as {
      agent?: { id?: string; name?: string };
      joinedAgent?: { id?: string; name?: string };
    };
    const resolvedAgent = joinedAny.agent || joinedAny.joinedAgent;
    const resolvedId = String(resolvedAgent?.id || "").trim();
    if (!resolvedId) {
      throw new Error("joinRoom response does not include agent id");
    }
    this.joinedAgentId = resolvedId;
    this.joinedAgentName = String(resolvedAgent?.name || this.options.adapter.name).trim() || this.options.adapter.name;
    await this.emitState("joined");
  }

  private async runInitialTurn(): Promise<void> {
    const context = await this.options.client.getRoomContext(this.options.roomId, this.options.role);
    const response = await this.options.adapter.respond(context);
    await this.postTurn(context, response, null, "initial room entry response");
    await this.refreshCursor();
    await this.emitState("idle");
  }

  private async runAutonomousLoop(): Promise<void> {
    const pollIntervalMs = Math.max(1_000, this.options.pollIntervalMs ?? DEFAULT_POLL_MS);
    const loopGuardEnabled = this.options.loopGuardEnabled !== false;
    const maxNoActionStreak = Math.max(1, this.options.maxNoActionStreak ?? DEFAULT_MAX_NO_ACTION_STREAK);

    while (!this.options.shouldStop?.()) {
      const messages = await this.options.client.getRoomMessages(this.options.roomId, 30);
      const ordered = [...messages.messages].sort(
        (left, right) => Date.parse(left.timestamp || "") - Date.parse(right.timestamp || "")
      );
      const unseen = this.getUnseenMessages(ordered);
      this.lastSeenMessageId = ordered.at(-1)?.id || this.lastSeenMessageId;
      const roomFingerprint = this.buildRoomFingerprint(ordered);

      if (unseen.length === 0) {
        await this.recordNoAction("no_unseen_messages", roomFingerprint);
        await this.sleep(pollIntervalMs);
        continue;
      }

      if (
        loopGuardEnabled
        &&
        this.lastCycleOutcome === "no_action"
        && roomFingerprint === this.lastRoomFingerprint
        && this.noActionStreak >= maxNoActionStreak
      ) {
        await this.recordNoAction("unchanged_room_fingerprint", roomFingerprint);
        await this.sleep(pollIntervalMs);
        continue;
      }

      const context = await this.options.client.getRoomContext(this.options.roomId, this.options.role);
      const nextDecision = this.pickNextTrigger(unseen, context.phase, context.role);

      if (nextDecision) {
        await this.emitState("responding");
        this.options.logger?.info(`[session] Agent ${this.options.adapter.name} is generating response for room ${this.options.roomId}...`);
        let response: AgentResponse;
        try {
          response = await this.options.adapter.respond(context);
        } catch (error) {
          if (!this.isRecoverableAdapterError(error)) {
            throw error;
          }
          this.options.logger?.warn(
            `[session] recoverable adapter error room=${this.options.roomId} agent=${this.options.adapter.name}; marking no-action and retrying next cycle`
          );
          await this.recordNoAction("adapter_recoverable", roomFingerprint);
          await this.sleep(pollIntervalMs);
          continue;
        }
        this.options.logger?.info(`[session] Agent ${this.options.adapter.name} response generated, posting to room...`);
        await this.postTurn(context, response, nextDecision.triggeredBy, nextDecision.reason);
        this.lastCycleOutcome = "acted";
        this.lastNoActionReason = null;
        this.noActionStreak = 0;
        this.lastRoomFingerprint = roomFingerprint;
        await this.refreshCursor();
        await this.emitState("idle");
        continue;
      }

      await this.recordNoAction("policy_rejected_unseen_messages", roomFingerprint);

      await this.sleep(pollIntervalMs);
    }
  }

  private pickNextTrigger(
    unseen: CoreRoomMessage[],
    roomPhase: string,
    roomRole: string
  ): { triggeredBy: string; reason: string } | null {
    for (let index = unseen.length - 1; index >= 0; index -= 1) {
      const message = unseen[index];
      const decision = evaluateRoomAgentPolicy({
        candidate: message,
        adapterName: this.options.adapter.name,
        joinedAgentName: this.joinedAgentName,
        roomPhase,
        roomRole,
        lastRespondedMessageId: this.lastRespondedMessageId,
        lastRespondedAt: this.lastRespondedAt,
        cooldownMs: DEFAULT_AUTONOMOUS_COOLDOWN_MS,
        now: Date.now()
      });
      if (decision.shouldRespond && decision.triggeredBy) {
        return {
          triggeredBy: decision.triggeredBy,
          reason: decision.reason
        };
      }
    }

    return null;
  }

  private getUnseenMessages(messages: CoreRoomMessage[]): CoreRoomMessage[] {
    if (!this.lastSeenMessageId) {
      return messages;
    }

    const lastSeenIndex = messages.findIndex((message) => message.id === this.lastSeenMessageId);
    if (lastSeenIndex === -1) {
      return messages;
    }

    return messages.slice(lastSeenIndex + 1);
  }

  private async postTurn(
    context: RoomContext,
    response: AgentResponse,
    triggeredBy: string | null,
    reason: string
  ): Promise<void> {
    if (!this.joinedAgentId) {
      throw new Error("Room session has no joined agent id");
    }

    await this.options.client.postRoomMessage({
      roomId: this.options.roomId,
      joinedAgentId: this.joinedAgentId,
      text: this.decorateResponseText(response),
      confidence: response.confidence,
      artifacts: response.artifacts,
      pythonCode: response.pythonCode,
      needHuman: response.needHuman,
      triggeredBy
    });

    this.lastRespondedMessageId = triggeredBy;
    this.lastRespondedAt = Date.now();

    await this.options.onTurn?.({
      context,
      response,
      triggeredBy,
      joinedAgentId: this.joinedAgentId,
      reason
    });
  }

  private decorateResponseText(response: AgentResponse): string {
    const normalizedText = this.normalizeConversationalText(response.text);
    if (!response.pythonCode) {
      return normalizedText;
    }
    return `${normalizedText}\n\nPython snippet:\n${response.pythonCode}`;
  }

  private normalizeConversationalText(text: string): string {
    const raw = String(text || "").trim();
    if (!raw) {
      return "";
    }

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        let next = line;

        // Drop markdown headings and list markers.
        next = next.replace(/^#{1,6}\s+/, "");
        next = next.replace(/^[-*+]\s+/, "");
        next = next.replace(/^\d+[.)]\s+/, "");

        // Remove common report section labels.
        next = next.replace(/^(claim|evidence|counterpoint|conclusion|summary|core debate|follow-up question)\s*:\s*/i, "");

        // Remove markdown emphasis markers.
        next = next.replace(/\*\*(.*?)\*\*/g, "$1");
        next = next.replace(/__(.*?)__/g, "$1");
        next = next.replace(/`([^`]+)`/g, "$1");

        return next.trim();
      })
      .filter(Boolean);

    // Keep reply compact and conversational.
    let compact = lines.join(" ").replace(/\s{2,}/g, " ").trim();

    // Remove dangling punctuation that often appears after truncated generations.
    compact = compact.replace(/\s*[-–—]\s*$/, "");
    compact = compact.replace(/\s*[:;,]\s*$/, "");
    compact = compact.replace(/\(\s*$/, "").trim();

    if (compact && !/[.!?…]$/.test(compact) && compact.split(/\s+/).length > 6) {
      compact = `${compact}.`;
    }

    return compact;
  }

  private async refreshCursor(): Promise<void> {
    const latest = await this.options.client.getRoomMessages(this.options.roomId, 100);
    const ordered = [...latest.messages].sort(
      (left, right) => Date.parse(left.timestamp || "") - Date.parse(right.timestamp || "")
    );
    this.lastSeenMessageId = ordered.at(-1)?.id || this.lastSeenMessageId;
  }

  private shouldResumeAutonomousSession(): boolean {
    return Boolean(this.options.autonomous && this.joinedAgentId && this.lastSeenMessageId);
  }

  private async emitState(status: RoomSessionStatus): Promise<void> {
    this.status = status;
    await this.options.onStateChange?.({
      roomId: this.options.roomId,
      agentName: this.options.adapter.name,
      role: this.options.role,
      joinedAgentId: this.joinedAgentId || undefined,
      lastSeenMessageId: this.lastSeenMessageId || undefined,
      lastRespondedMessageId: this.lastRespondedMessageId || undefined,
      lastRespondedAt: this.lastRespondedAt || undefined,
      lastRoomFingerprint: this.lastRoomFingerprint || undefined,
      lastCycleOutcome: this.lastCycleOutcome || undefined,
      lastNoActionReason: this.lastNoActionReason || undefined,
      noActionStreak: this.noActionStreak,
      autonomous: Boolean(this.options.autonomous),
      status
    });
  }

  private async recordNoAction(reason: string, roomFingerprint: string): Promise<void> {
    this.lastCycleOutcome = "no_action";
    this.lastNoActionReason = reason;
    this.lastRoomFingerprint = roomFingerprint;
    this.noActionStreak += 1;
    await this.emitState("idle");
  }

  private buildRoomFingerprint(messages: CoreRoomMessage[]): string {
    const recent = messages.slice(-8).map((message) => `${message.id}:${message.from}:${message.scope}`);
    return `${messages.length}|${recent.join("|")}`;
  }

  private sleep(ms: number): Promise<void> {
    const stepMs = 250;
    return new Promise((resolve) => {
      let elapsed = 0;
      const tick = () => {
        if (this.options.shouldStop?.() || elapsed >= ms) {
          resolve();
          return;
        }
        elapsed += stepMs;
        setTimeout(tick, Math.min(stepMs, Math.max(1, ms - elapsed + stepMs)));
      };
      tick();
    });
  }

  private isRecoverableAdapterError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || "");
    return /timed out|empty response/i.test(message);
  }
}


