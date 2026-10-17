// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatcher, createSemaphore } from '@/src/background/batching';

describe('createSemaphore', () => {
  it('同时运行的任务不超过上限', async () => {
    const semaphore = createSemaphore(2);
    let running = 0;
    let peak = 0;
    const task = () =>
      semaphore.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      });
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });

  it('任务失败也会释放名额并向上抛错', async () => {
    const semaphore = createSemaphore(1);
    await expect(semaphore.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('createBatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (flush: (b: readonly string[]) => void) =>
    createBatcher<string>({ maxItems: 3, maxChars: 10, waitMs: 100, size: (s) => s.length, flush });

  it('等待 waitMs 后发送', () => {
    const flush = vi.fn();
    const batcher = make(flush);
    batcher.push('a');
    batcher.push('b');
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledWith(['a', 'b']);
  });

  it('满 maxItems 立即发送', () => {
    const flush = vi.fn();
    const batcher = make(flush);
    ['a', 'b', 'c'].forEach((s) => batcher.push(s));
    expect(flush).toHaveBeenCalledWith(['a', 'b', 'c']);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('超出 maxChars 时先发送已有的', () => {
    const flush = vi.fn();
    const batcher = make(flush);
    batcher.push('123456');
    batcher.push('7890ab');
    expect(flush).toHaveBeenCalledWith(['123456']);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenLastCalledWith(['7890ab']);
  });

  it('dispose 后不再发送', () => {
    const flush = vi.fn();
    const batcher = make(flush);
    batcher.push('a');
    batcher.dispose();
    vi.advanceTimersByTime(100);
    expect(flush).not.toHaveBeenCalled();
  });
});
