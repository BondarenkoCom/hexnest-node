import { HexNestClient } from "../protocol/HexNestClient.js";
import { UsageRecord } from "../protocol/types.js";

export class CommissionMeter {
  private readonly usage: UsageRecord[] = [];
  private rooms = new Set<string>();
  private tokensUsed = 0;

  track(record: UsageRecord): void {
    this.usage.push(record);
    this.rooms.add(record.roomId);
    this.tokensUsed += record.inputTokens + record.outputTokens;
  }

  getSnapshot(): {
    totalTokensUsed: number;
    totalRoomsJoined: number;
    pendingUsageRecords: number;
  } {
    return {
      totalTokensUsed: this.tokensUsed,
      totalRoomsJoined: this.rooms.size,
      pendingUsageRecords: this.usage.length
    };
  }

  pendingRecords(): UsageRecord[] {
    return [...this.usage];
  }

  async submit(client: HexNestClient, nodeId: string): Promise<{ accepted: number; totalOwed: number }> {
    if (!this.usage.length) {
      return { accepted: 0, totalOwed: 0 };
    }
    const batch = [...this.usage];
    const result = await client.submitUsage(nodeId, batch);
    if (result.accepted > 0) {
      this.usage.splice(0, result.accepted);
    }
    return result;
  }
}
