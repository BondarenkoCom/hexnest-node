import { HexNestClientLike } from "../protocol/HexNestClient.js";
import { UsageRecord } from "../protocol/types.js";

export class CommissionMeter {
  private readonly usage: UsageRecord[] = [];
  private readonly rooms = new Set<string>();
  private tokensUsed = 0;
  private estimatedCostUsd = 0;

  track(record: UsageRecord): void {
    this.usage.push(record);
    this.rooms.add(record.roomId);
    this.tokensUsed += record.inputTokens + record.outputTokens;
    this.estimatedCostUsd += Number(record.estimatedCostUsd || 0);
  }

  getSnapshot(): {
    totalTokensUsed: number;
    totalRoomsJoined: number;
    totalEstimatedCostUsd: number;
    pendingUsageRecords: number;
  } {
    return {
      totalTokensUsed: this.tokensUsed,
      totalRoomsJoined: this.rooms.size,
      totalEstimatedCostUsd: Number(this.estimatedCostUsd.toFixed(6)),
      pendingUsageRecords: this.usage.length
    };
  }

  pendingRecords(): UsageRecord[] {
    return [...this.usage];
  }

  async submit(
    client: HexNestClientLike,
    nodeId: string,
    batchSize = 100
  ): Promise<{ accepted: number; totalOwed: number }> {
    if (this.usage.length === 0) {
      return { accepted: 0, totalOwed: 0 };
    }

    let acceptedTotal = 0;
    let totalOwed = 0;
    const safeBatchSize = Math.max(1, Math.min(batchSize, 500));

    while (this.usage.length > 0) {
      const batch = this.usage.slice(0, safeBatchSize);
      const result = await client.submitUsage(nodeId, batch);
      const accepted = Math.max(0, Math.min(Number(result.accepted || 0), batch.length));
      if (accepted === 0) {
        break;
      }

      this.usage.splice(0, accepted);
      acceptedTotal += accepted;
      totalOwed += Number(result.totalOwed || 0);

      if (accepted < batch.length) {
        break;
      }
    }

    return { accepted: acceptedTotal, totalOwed };
  }
}


