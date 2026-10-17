import { describe, expect, it, vi, afterEach } from 'vitest';
import { createLocalEngine, downloadLocalModel, localAvailability } from '@/src/content/local-engine';

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

describe('createLocalEngine', () => {
  afterEach(() => vi.restoreAllMocks());

  it('可用时返回翻译器', async () => {
    const engine = await createLocalEngine(fakeScope('available'));
    expect(await engine!.translate('hi')).toBe('译:hi');
  });

  it('未下载模型时返回 null', async () => {
    expect(await createLocalEngine(fakeScope('downloadable'))).toBeNull();
  });

  it('create 抛错时返回 null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scope = fakeScope('available');
    scope.Translator.create.mockRejectedValueOnce(new Error('fail'));
    expect(await createLocalEngine(scope)).toBeNull();
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
