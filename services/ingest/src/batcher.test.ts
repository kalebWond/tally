import { describe, expect, it, vi } from 'vitest';
import { createBatcher } from './batcher.js';

describe('createBatcher', () => {
  it('coalesces calls made within the window into one flush', async () => {
    const flush = vi.fn(async (_items: number[]) => {});
    const add = createBatcher(flush, { maxBatch: 100, maxWaitMs: 5 });

    await Promise.all([add(1), add(2), add(3)]);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('flushes immediately at maxBatch without waiting for the timer', async () => {
    const flush = vi.fn(async (_items: number[]) => {});
    const add = createBatcher(flush, { maxBatch: 2, maxWaitMs: 60_000 });

    await Promise.all([add(1), add(2), add(3), add(4)]);

    expect(flush.mock.calls).toEqual([[[1, 2]], [[3, 4]]]);
  });

  it('rejects every caller in a failed batch — none resolve as if accepted', async () => {
    const add = createBatcher(
      async () => {
        throw new Error('broker down');
      },
      { maxBatch: 100, maxWaitMs: 1 },
    );

    const results = await Promise.allSettled([add(1), add(2), add(3)]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
  });

  it('a failed batch does not poison the next one', async () => {
    let fail = true;
    const add = createBatcher(
      async () => {
        if (fail) throw new Error('broker down');
      },
      { maxBatch: 100, maxWaitMs: 1 },
    );

    await expect(add(1)).rejects.toThrow('broker down');
    fail = false;
    await expect(add(2)).resolves.toBeUndefined();
  });
});
