import { AgentAdapter, AgentResponse } from "../adapters/AgentAdapter.js";
import type { RoomSessionState, RoomSessionStatus } from "../db/database.js";
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
  pollIntervalMs?: number;
  shouldStop?: () => boolean;
  initialState?: RoomSessionState | null;
  onStateChange?: (state: Omit<RoomSessionState, "createdAt" | "updatedAt">) => Promise<void> | void;
  onTurn?: (turn: RoomAgentTurn) => Promise<void> | void;
  logger?: RoomAgentSessionLogger;
}

const DEFAULT_POLL_MS = 8_000;
const DEFAULT_AUTONOMOUS_COOLDOWN_MS = 15_000;

export class RoomAgentSession {
  private joinedAgentId: string | null = null;
  private joinedAgentName: string | null = null;
  private lastSeenMessageId: string | null = null;
  private lastRespondedMessageId: string | null = null;
  private lastRespondedAt: number | null = null;
  private status: RoomSessionStatus = "starting";

  constructor(private readonly options: RoomAgentSessionOptions) {
    const initial = options.initialState;
    if (initial) {
      this.joinedAgentId = initial.joinedAgentId || null;
      this.lastSeenMessageId = initial.lastSeenMessageId || null;
      this.lastRespondedMessageId = initial.lastRespondedMessageId || null;
      this.lastRespondedAt = initial.lastRespondedAt || null;
      this.status = initial.status || "starting";
    }
  }

  async run(): Promise<void> {
    await this.emitState("starting");
    try {
      await this.ensureJoined();

      if (this.shouldResumeAutonomousSession()) {
        await this.emitState("idle");
        await this.runAutonomousLoop();
        await this.emitState("stopped");
        return;
      }

      await this.runInitialTurn();

      if (!this.options.autonomous) {
        await this.emitState("stopped");
        return;
      }

      await this.runAutonomousLoop();
      await this.emitState("stopped");
    } catch (error) {
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
    this.joinedAgentId = joined.joinedAgent.id;
    this.joinedAgentName = joined.joinedAgent.name;
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

    while (!this.options.shouldStop?.()) {
      const messages = await this.options.client.getRoomMessages(this.options.roomId, 100);
      const ordered = [...messages.messages].sort(
        (left, right) => Date.parse(left.timestamp || "") - Date.parse(right.timestamp || "")
      );
      const unseen = this.getUnseenMessages(ordered);
      this.lastSeenMessageId = ordered.at(-1)?.id || this.lastSeenMessageId;

      if (unseen.length === 0) {
        await this.sleep(pollIntervalMs);
        continue;
      }

      const context = await this.options.client.getRoomContext(this.options.roomId, this.options.role);
      const nextDecision = this.pickNextTrigger(unseen, context.phase, context.role);

      if (nextDecision) {
        await this.emitState("responding");
        const response = await this.options.adapter.respond(context);
        await this.postTurn(context, response, nextDecision.triggeredBy, nextDecision.reason);
        await this.refreshCursor();
        await this.emitState("idle");
        continue;
      }

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
    if (!response.pythonCode) {
      return response.text;
    }
    return `${response.text}\n\nPython snippet:\n\`\`\`python\n${response.pythonCode}\n\`\`\``;
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
      autonomous: Boolean(this.options.autonomous),
      status
    });
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
}