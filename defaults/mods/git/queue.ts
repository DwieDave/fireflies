// The git window's job queues: a long-lived task drains each, so async work
// keeps that task's cx (main.ts: acts for git actions, reads for reads).

import type { AsyncContext } from "gpui-kit";

/** A job queue a long-lived task drains: async work keeps that task's cx. */
export type Job = (cx: AsyncContext) => Promise<void> | void;

export class Queue {
  items: Job[] = [];
  wake: (() => void) | null = null;

  push(job: Job) {
    this.items.push(job);

    const w = this.wake;

    this.wake = null;
    w?.();
  }

  async next(): Promise<Job> {
    for (;;) {
      const job = this.items.shift();

      if (job) return job;

      await new Promise<void>((r) => { this.wake = r; });
    }
  }
}
