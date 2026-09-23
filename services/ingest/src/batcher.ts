interface BatchOptions {
  /** Flush as soon as this many items are waiting. */
  maxBatch: number;
  /** Otherwise flush this long after the first item arrived. */
  maxWaitMs: number;
}

/**
 * Coalesces concurrent calls into one `flush`. Each caller's promise settles with its batch:
 * resolved once the flush succeeds, rejected if it throws. Nothing is left pending.
 */
export function createBatcher<T>(flush: (items: T[]) => Promise<void>, opts: BatchOptions) {
  let pending: { item: T; resolve: () => void; reject: (err: unknown) => void }[] = [];
  let timer: NodeJS.Timeout | undefined;

  const run = () => {
    clearTimeout(timer);
    timer = undefined;
    const batch = pending;
    pending = [];
    flush(batch.map((p) => p.item)).then(
      () => {
        for (const p of batch) p.resolve();
      },
      (err: unknown) => {
        for (const p of batch) p.reject(err);
      },
    );
  };

  return (item: T) =>
    new Promise<void>((resolve, reject) => {
      pending.push({ item, resolve, reject });
      if (pending.length >= opts.maxBatch) run();
      else timer ??= setTimeout(run, opts.maxWaitMs);
    });
}
