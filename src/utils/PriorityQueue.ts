export interface QueueTask<T = any> {
  id: string;
  priority: number;
  timestamp: number;
  fn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

export interface PriorityQueueOptions {
  concurrency: number;
  maxQueueSize: number;
}

export class PriorityQueue {
  private queue: QueueTask[] = [];
  private activeCount = 0;
  private readonly concurrency: number;
  private readonly maxQueueSize: number;

  constructor(options: PriorityQueueOptions) {
    this.concurrency = Math.max(1, options.concurrency);
    this.maxQueueSize = Math.max(this.concurrency, options.maxQueueSize);
  }

  public async add<T>(fn: () => Promise<T>, priority: number = 0, id: string = Math.random().toString(36).slice(2)): Promise<T> {
    const totalCount = this.queue.length + this.activeCount;
    if (totalCount >= this.maxQueueSize) {
      throw new Error(`Queue limit reached (${this.maxQueueSize}). Memory protection active.`);
    }

    return new Promise<T>((resolve, reject) => {
      const task: QueueTask<T> = {
        id,
        priority,
        timestamp: Date.now(),
        fn,
        resolve,
        reject
      };

      this.queue.push(task);
      this.sortQueue();
      this.next();
    });
  }

  private sortQueue(): void {
    // Higher priority first, then older timestamp first
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.timestamp - b.timestamp;
    });
  }

  private next(): void {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.activeCount++;
    
    task.fn()
      .then((result) => {
        task.resolve(result);
      })
      .catch((error) => {
        task.reject(error);
      })
      .finally(() => {
        this.activeCount--;
        this.next();
      });
  }

  public get pendingCount(): number {
    return this.queue.length;
  }

  public get runningCount(): number {
    return this.activeCount;
  }

  public get isFull(): boolean {
    return this.queue.length >= this.maxQueueSize;
  }
}
