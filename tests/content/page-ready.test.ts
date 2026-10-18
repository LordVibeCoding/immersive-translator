import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFragilePage, whenPageSettled } from '@/src/content/page-ready';

describe('isFragilePage', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('translate');
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('普通页面不算脆弱', () => {
    document.body.innerHTML = '<p>Hello</p>';
    expect(isFragilePage(document)).toBe(false);
  });

  it('<html>/<body> 上有不翻译标记的算脆弱（React 网站常见）', () => {
    document.documentElement.setAttribute('translate', 'no');
    expect(isFragilePage(document)).toBe(true);
    document.documentElement.removeAttribute('translate');
    document.body.className = 'notranslate';
    expect(isFragilePage(document)).toBe(true);
  });

  it('Next.js 页面算脆弱', () => {
    document.body.innerHTML = '<div id="__next"></div>';
    expect(isFragilePage(document)).toBe(true);
    document.body.innerHTML = '<script>(self.__next_f=self.__next_f||[]).push([0])</script>';
    expect(isFragilePage(document)).toBe(true);
  });
});

describe('whenPageSettled', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeWindow(readyState: DocumentReadyState) {
    const listeners: Record<string, () => void> = {};
    return {
      win: {
        document: { readyState },
        addEventListener: (type: string, fn: () => void) => void (listeners[type] = fn),
        removeEventListener: vi.fn(),
        requestIdleCallback: (fn: () => void) => setTimeout(fn, 10),
        setTimeout,
        clearTimeout,
      } as unknown as Window,
      fireLoad: () => listeners.load?.(),
    };
  }

  it('页面已加载完：只等浏览器空闲', async () => {
    const { win } = fakeWindow('complete');
    const done = vi.fn();
    void whenPageSettled(win).then(done);
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toHaveBeenCalled();
  });

  it('未加载完：等 load 事件后再等空闲', async () => {
    const { win, fireLoad } = fakeWindow('interactive');
    const done = vi.fn();
    void whenPageSettled(win).then(done);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).not.toHaveBeenCalled();
    fireLoad();
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toHaveBeenCalled();
  });

  it('load 迟迟不来时最多等待上限时间', async () => {
    const { win } = fakeWindow('loading');
    const done = vi.fn();
    void whenPageSettled(win, 500).then(done);
    await vi.advanceTimersByTimeAsync(510);
    expect(done).toHaveBeenCalled();
  });
});
