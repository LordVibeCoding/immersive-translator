import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Controller, type ControllerDeps, type CreateVisibilityObserver } from '@/src/content/controller';
import type { TranslateRequest } from '@/src/shared/messages';
import { CONTENT_FLUSH_MS, MUTATION_DEBOUNCE_MS } from '@/src/shared/constants';

const byId = (id: string) => document.getElementById(id)!;
const trText = (id: string) => byId(id).querySelector(':scope > it-tr')?.textContent ?? null;

/** 假的视口观察器：observe 即视为可见 */
const instantVisibility: CreateVisibilityObserver = (onVisible) => ({
  observe: (el) => onVisible([el]),
  disconnect: () => {},
});

/** 本文件内所有测试共享同一个 document，未显式 disable 的 controller 会残留
 *  MutationObserver 继续观察 document.body，污染后续测试；统一在 afterEach 收尾 */
let createdControllers: Controller[] = [];

function setup(overrides: Partial<ControllerDeps> = {}) {
  const requests: TranslateRequest[] = [];
  const controller = new Controller({
    doc: document,
    local: { translate: async (t) => `本地:${t}` },
    llmEnabled: true,
    mode: 'dual',
    sendToLlm: (r) => requests.push(r),
    createVisibilityObserver: instantVisibility,
    ...overrides,
  });
  createdControllers.push(controller);
  return { controller, requests };
}

const flush = () => vi.advanceTimersByTimeAsync(CONTENT_FLUSH_MS);

describe('Controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.title = 'Doc';
    document.documentElement.className = '';
    document.body.innerHTML = '<p id="p1">Hello world</p><p id="zh">这是中文段落内容</p><pre>code block</pre>';
  });
  afterEach(() => {
    createdControllers.forEach((c) => c.disable());
    createdControllers = [];
    vi.useRealTimers();
  });

  it('开启后本地出 draft，并把段落发给大模型', async () => {
    const { controller, requests } = setup();
    controller.enable();
    await flush();
    expect(trText('p1')).toBe('本地:Hello world');
    expect(byId('p1').querySelector('it-tr')!.classList.contains('it-draft')).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.pageTitle).toBe('Doc');
    expect(requests[0]!.items.map((i) => i.text)).toEqual(['Hello world']);
    expect(trText('zh')).toBeNull();
  });

  it('大模型结果以 final 覆盖 draft；之后到达的本地结果不再覆盖', async () => {
    let resolveLocal: (t: string) => void = () => {};
    const { controller, requests } = setup({
      local: { translate: () => new Promise<string>((r) => (resolveLocal = r)) },
    });
    controller.enable();
    await flush();
    controller.handleResult(requests[0]!.items[0]!.id, '你好世界');
    resolveLocal('本地结果');
    await Promise.resolve();
    expect(trText('p1')).toBe('你好世界');
  });

  it('未配置大模型时本地结果直接是 final，且不发请求', async () => {
    const { controller, requests } = setup({ llmEnabled: false });
    controller.enable();
    await flush();
    expect(trText('p1')).toBe('本地:Hello world');
    expect(byId('p1').querySelector('it-tr')!.classList.contains('it-draft')).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('toggle 与 setMode 切换 html 上的类', async () => {
    const { controller } = setup();
    controller.toggle();
    expect(document.documentElement.classList.contains('it-on')).toBe(true);
    controller.setMode('only');
    expect(controller.state).toEqual({ enabled: true, mode: 'only' });
    expect(document.documentElement.classList.contains('it-only')).toBe(true);
    controller.toggle();
    expect(document.documentElement.classList.contains('it-on')).toBe(false);
  });

  it('只看译文：已翻译段落原地替换；切回双语或关闭翻译时恢复原文，再开启时重新替换', async () => {
    const { controller, requests } = setup({ local: null });
    controller.enable();
    await flush();
    controller.handleResult(requests[0]!.items[0]!.id, '你好世界');
    const ownText = () => byId('p1').firstChild!.textContent;
    expect(ownText()).toBe('Hello world');

    controller.setMode('only');
    expect(ownText()).toBe('你好世界');
    controller.setMode('dual');
    expect(ownText()).toBe('Hello world');

    controller.setMode('only');
    controller.disable();
    expect(ownText()).toBe('Hello world');
    controller.enable();
    expect(ownText()).toBe('你好世界');
  });

  it('只看译文：原地替换不会被当成原文变化而重复请求', async () => {
    const { controller, requests } = setup({ local: null });
    controller.enable();
    controller.setMode('only');
    await flush();
    controller.handleResult(requests[0]!.items[0]!.id, '你好世界');
    expect(byId('p1').firstChild!.textContent).toBe('你好世界');
    await vi.advanceTimersByTimeAsync(MUTATION_DEBOUNCE_MS + CONTENT_FLUSH_MS);
    expect(requests).toHaveLength(1);
  });

  it('被样式设成全大写显示的短标签不翻译', async () => {
    document.body.innerHTML = '<p id="p1">Hello world</p><span id="badge" style="display:block;text-transform:uppercase">New</span>';
    const { controller, requests } = setup();
    controller.enable();
    await flush();
    expect(requests[0]!.items.map((i) => i.text)).toEqual(['Hello world']);
  });

  it('动态新增的段落会被翻译', async () => {
    const { controller } = setup();
    controller.enable();
    await flush();
    const p = document.createElement('p');
    p.id = 'p2';
    p.textContent = 'New paragraph here';
    document.body.append(p);
    await vi.advanceTimersByTimeAsync(MUTATION_DEBOUNCE_MS + CONTENT_FLUSH_MS);
    expect(trText('p2')).toBe('本地:New paragraph here');
  });

  it('已翻译段落的原文变化后重新翻译', async () => {
    const { controller, requests } = setup();
    controller.enable();
    await flush();
    controller.handleResult(requests[0]!.items[0]!.id, '你好世界');
    byId('p1').firstChild!.textContent = 'Changed text';
    await vi.advanceTimersByTimeAsync(MUTATION_DEBOUNCE_MS + CONTENT_FLUSH_MS);
    expect(requests.at(-1)!.items.map((i) => i.text)).toEqual(['Changed text']);
    expect(trText('p1')).toBe('本地:Changed text');
  });

  it('自己插入译文不会触发重复请求', async () => {
    const { controller, requests } = setup();
    controller.enable();
    await flush();
    controller.handleResult(requests[0]!.items[0]!.id, '你好世界');
    await vi.advanceTimersByTimeAsync(MUTATION_DEBOUNCE_MS + CONTENT_FLUSH_MS);
    expect(requests).toHaveLength(1);
  });

  it('关闭后新增内容不再翻译', async () => {
    const { controller } = setup();
    controller.enable();
    await flush();
    controller.disable();
    const p = document.createElement('p');
    p.id = 'p3';
    p.textContent = 'Added while off';
    document.body.append(p);
    await vi.advanceTimersByTimeAsync(MUTATION_DEBOUNCE_MS + CONTENT_FLUSH_MS);
    expect(trText('p3')).toBeNull();
  });

  it('未配置大模型时，本地翻译失败不会永久卡死；disable/enable 后可重试', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let call = 0;
    const { controller } = setup({
      llmEnabled: false,
      local: {
        translate: async (t) => {
          call++;
          if (call === 1) throw new Error('local fail');
          return `本地:${t}`;
        },
      },
    });
    controller.enable();
    await flush();
    controller.disable();
    controller.enable();
    await flush();
    expect(trText('p1')).toBe('本地:Hello world');
    warn.mockRestore();
  });

  it('译文节点被外部删除后会重新渲染', async () => {
    const { controller, requests } = setup();
    controller.enable();
    await flush();
    controller.handleResult(requests[0]!.items[0]!.id, '你好世界');
    byId('p1').querySelector('it-tr')!.remove();
    await vi.advanceTimersByTimeAsync(MUTATION_DEBOUNCE_MS + CONTENT_FLUSH_MS);
    expect(trText('p1')).toBe('本地:Hello world');
  });

  it('请求进行中原文发生变化后，旧任务条目会被释放', async () => {
    const { controller, requests } = setup({
      local: { translate: () => new Promise<string>(() => {}) },
    });
    controller.enable();
    await flush();
    byId('p1').firstChild!.textContent = 'Changed text';
    await vi.advanceTimersByTimeAsync(MUTATION_DEBOUNCE_MS + CONTENT_FLUSH_MS);
    expect(requests).toHaveLength(2);
    expect((controller as unknown as { units: Map<string, unknown> }).units.size).toBe(1);
  });

  it('发送给大模型抛错时，本批本地翻译仍会执行', async () => {
    const { controller } = setup({
      sendToLlm: () => {
        throw new Error('Extension context invalidated.');
      },
    });
    controller.enable();
    await flush().catch(() => {});
    await Promise.resolve();
    expect(trText('p1')).toBe('本地:Hello world');
  });

  it('段落被移出 DOM 后，下次 flush 释放它的任务条目', async () => {
    const { controller } = setup({
      local: { translate: () => new Promise<string>(() => {}) },
    });
    controller.enable();
    await flush();
    const units = (controller as unknown as { units: Map<string, { block: Element }> }).units;
    expect([...units.values()].map((u) => u.block.id)).toEqual(['p1']);
    byId('p1').remove();
    const p = document.createElement('p');
    p.id = 'p2';
    p.textContent = 'New paragraph here';
    document.body.append(p);
    await vi.advanceTimersByTimeAsync(MUTATION_DEBOUNCE_MS + CONTENT_FLUSH_MS);
    expect([...units.values()].map((u) => u.block.id)).toEqual(['p2']);
  });

  it('setLocalEngine 之后进入视口的新段落走本地翻译', async () => {
    const { controller } = setup({ local: null });
    controller.enable();
    await flush();
    expect(trText('p1')).toBeNull();
    controller.setLocalEngine({ translate: async (t) => `新本地:${t}` });
    const p = document.createElement('p');
    p.id = 'p2';
    p.textContent = 'New paragraph here';
    document.body.append(p);
    await vi.advanceTimersByTimeAsync(MUTATION_DEBOUNCE_MS + CONTENT_FLUSH_MS);
    expect(trText('p2')).toBe('新本地:New paragraph here');
  });

  it('未配置大模型时，setLocalEngine 会补翻此前因没有本地引擎而卡住的段落', async () => {
    const { controller } = setup({ local: null, llmEnabled: false });
    controller.enable();
    await flush();
    expect(trText('p1')).toBeNull();
    controller.setLocalEngine({ translate: async (t) => `新本地:${t}` });
    await vi.advanceTimersByTimeAsync(0);
    expect(trText('p1')).toBe('新本地:Hello world');
  });
});
