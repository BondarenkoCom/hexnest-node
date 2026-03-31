import { HexNestClient } from "../protocol/HexNestClient.js";
import { HeartbeatPayload, HeartbeatResponse } from "../protocol/types.js";

export class Heartbeat {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: HexNestClient,
    private readonly nodeId: string,
    private readonly intervalMs: number,
    private readonly payloadFactory: () => HeartbeatPayload,
    private readonly onResponse?: (response: HeartbeatResponse) => Promise<void> | void
  ) {}

  async pulse(): Promise<HeartbeatResponse> {
    const payload = this.payloadFactory();
    const response = await this.client.heartbeat(this.nodeId, payload);
    if (this.onResponse) {
      await this.onResponse(response);
    }
    return response;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.pulse().catch((error) => {
        console.error("[heartbeat] pulse failed:", error instanceof Error ? error.message : String(error));
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
