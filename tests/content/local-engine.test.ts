import { describe, expect, it, vi, afterEach } from 'vitest';
import { createLocalEngineOnGesture, downloadLocalModel, localAvailability } from '@/src/content/local-engine';

function fakeScope(availability: string | Error, created = { translate: async (t: string) => `译:${t}` }) {
  return {
    Translator: {
      availability: vi.fn(async () => {
        if (availability instanceof Error) throw availability;
        return availability;
      }),
      create: vi.fn(async (opts: { monitor?: (m: { addEventListener: Function }) => void }) => {
        opts.monitor?.({ addEventListener: (_type: string, fn: (e: { loaded: number }) => void) => fn({ loaded: 0.5 }) });
        return created;
      }),
    },
  };
}

describe('localAvailability', () => {
  afterEach(() => vi.restoreAllMocks());

  it('没有 Translator 全局对象时为 unsupported', async () => {
    expect(await localAvailability({})).toBe('unsupported');
  });

  it('透传合法状态，未知状态视为 unavailable', async () => {
    expect(await localAvailability(fakeScope('downloadable'))).toBe('downloadable');
    expect(await localAvailability(fakeScope('weird'))).toBe('unavailable');
  });

  it('查询抛错时为 unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await localAvailability(fakeScope(new Error('boom')))).toBe('unavailable');
  });

  it('使用固定的英译中语言对', async () => {
    const scope = fakeScope('available');
    await localAvailability(scope);
    expect(scope.Translator.availability).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'zh' });
  });
});

describe('createLocalEngineOnGesture', () => {
  afterEach(() => vi.restoreAllMocks());

  /** 让 create() 返回的 Promise 链走完 */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('available 时立即创建并回调，不注册手势监听', async () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const onReady = vi.fn();
    await createLocalEngineOnGesture(onReady, fakeScope('available'), target);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(await onReady.mock.calls[0]![0].translate('hi')).toBe('译:hi');
    expect(add).not.toHaveBeenCalled();
  });

  it('downloadable 时等页面上第一次 pointerdown 再创建，之后监听全部移除', async () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const scope = fakeScope('downloadable');
    const onReady = vi.fn();
    await createLocalEngineOnGesture(onReady, scope, target);
    expect(scope.Translator.create).not.toHaveBeenCalled();
    expect(add.mock.calls.map(([type, , opts]) => [type, opts])).toEqual([
      ['pointerdown', true],
      ['keydown', true],
    ]);

    target.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(onReady).toHaveBeenCalledTimes(1);

    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(scope.Translator.create).toHaveBeenCalledTimes(1);
  });

  it('不产生用户激活的事件（单独按 Option/Esc 等）不消耗监听，等下一次有效操作', async () => {
    const target = new EventTarget();
    const scope = fakeScope('downloadable');
    const onReady = vi.fn();
    let activated = false;
    await createLocalEngineOnGesture(onReady, scope, target, () => activated);
    target.dispatchEvent(new Event('keydown'));
    await settle();
    expect(scope.Translator.create).not.toHaveBeenCalled();

    activated = true;
    target.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('创建失败时继续等待下一次操作', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const target = new EventTarget();
    const scope = fakeScope('downloadable');
    scope.Translator.create.mockRejectedValueOnce(new Error('NotAllowedError'));
    const onReady = vi.fn();
    await createLocalEngineOnGesture(onReady, scope, target);
    target.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(onReady).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('downloading 时按键也能触发创建', async () => {
    const target = new EventTarget();
    const onReady = vi.fn();
    await createLocalEngineOnGesture(onReady, fakeScope('downloading'), target);
    target.dispatchEvent(new Event('keydown'));
    await settle();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('unavailable / unsupported 时不注册监听也不创建', async () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const scope = fakeScope('unavailable');
    const onReady = vi.fn();
    await createLocalEngineOnGesture(onReady, scope, target);
    await createLocalEngineOnGesture(onReady, {}, target);
    expect(add).not.toHaveBeenCalled();
    expect(scope.Translator.create).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('create 抛错时告警且不回调', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scope = fakeScope('available');
    scope.Translator.create.mockRejectedValueOnce(new Error('fail'));
    const onReady = vi.fn();
    await createLocalEngineOnGesture(onReady, scope, new EventTarget());
    expect(onReady).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});

describe('downloadLocalModel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('回调下载进度', async () => {
    const progress: number[] = [];
    await downloadLocalModel((r) => progress.push(r), fakeScope('downloadable'));
    expect(progress).toEqual([0.5]);
  });

  it('不支持时抛错', async () => {
    await expect(downloadLocalModel(() => {}, {})).rejects.toThrow('不支持');
  });
});
