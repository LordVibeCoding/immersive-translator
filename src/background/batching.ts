export interface Semaphore {
  run<T>(task: () => Promise<T>): Promise<T>;
}

/** 名额直接移交给等待者，避免释放瞬间被插队导致超额 */
export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const waiters: (() => void)[] = [];

  const acquire = async (): Promise<void> => {
    if (active < max) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  };

  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else active--;
  };

  return {
    async run(task) {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

export interface BatcherOptions<T> {
  readonly maxItems: number;
  readonly maxChars: number;
  readonly waitMs: number;
  readonly size: (item: T) => number;
  readonly flush: (batch: readonly T[]) => void;
}

export function createBatcher<T>(options: BatcherOptions<T>) {
  let pending: readonly T[] = [];
  let chars = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reset = (): void => {
    clearTimeout(timer);
    timer = undefined;
    pending = [];
    chars = 0;
  };

  const flushNow = (): void => {
    const batch = pending;
    reset();
    if (batch.length > 0) options.flush(batch);
  };

  return {
    push(item: T): void {
      const size = options.size(item);
      if (pending.length > 0 && chars + size > options.maxChars) flushNow();
      pending = [...pending, item];
      chars += size;
      if (pending.length >= options.maxItems) flushNow();
      else timer ??= setTimeout(flushNow, options.waitMs);
    },
    dispose: reset,
  };
}
