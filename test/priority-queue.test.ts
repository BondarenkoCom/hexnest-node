import { describe, it, expect, vi } from 'vitest';
import { PriorityQueue } from '../src/utils/PriorityQueue.js';

describe('PriorityQueue', () => {
  it('should execute tasks based on priority', async () => {
    const queue = new PriorityQueue({ concurrency: 1, maxQueueSize: 10 });
    const results: string[] = [];

    const task1 = () => new Promise<void>(resolve => {
      setTimeout(() => {
        results.push('task1');
        resolve();
      }, 50);
    });

    const task2 = () => {
      results.push('task2');
      return Promise.resolve();
    };

    const task3 = () => {
      results.push('task3');
      return Promise.resolve();
    };

    // Start a long task
    const p1 = queue.add(task1, 10);
    // Add lower priority
    const p2 = queue.add(task2, 5);
    // Add higher priority - should jump ahead of task2
    const p3 = queue.add(task3, 20);

    await Promise.all([p1, p2, p3]);

    // task1 started first, then task3 should go before task2
    expect(results).toEqual(['task1', 'task3', 'task2']);
  });

  it('should respect concurrency limits', async () => {
    const queue = new PriorityQueue({ concurrency: 2, maxQueueSize: 10 });
    let active = 0;
    let maxSeenActive = 0;

    const task = () => new Promise<void>(resolve => {
      active++;
      maxSeenActive = Math.max(maxSeenActive, active);
      setTimeout(() => {
        active--;
        resolve();
      }, 50);
    });

    const promises = Array.from({ length: 5 }, () => queue.add(task));
    await Promise.all(promises);

    expect(maxSeenActive).toBe(2);
  });

  it('should throw error when queue is full (memory protection)', async () => {
    const queue = new PriorityQueue({ concurrency: 1, maxQueueSize: 2 });
    
    // Add one running task
    queue.add(() => new Promise(resolve => setTimeout(resolve, 100)));
    // Add one pending task
    queue.add(() => Promise.resolve());
    
    // Third task should fail immediately
    await expect(queue.add(() => Promise.resolve())).rejects.toThrow(/Queue limit reached/);
  });

  it('should handle task failures without stopping the queue', async () => {
    const queue = new PriorityQueue({ concurrency: 1, maxQueueSize: 5 });
    const results: string[] = [];

    const failingTask = () => Promise.reject(new Error('fail'));
    const successTask = () => {
      results.push('success');
      return Promise.resolve();
    };

    await expect(queue.add(failingTask)).rejects.toThrow('fail');
    await queue.add(successTask);

    expect(results).toEqual(['success']);
  });
});
