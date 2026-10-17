import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { createLlmChannel } from '@/src/content/llm-channel';
import { PORT_NAME } from '@/src/shared/constants';
import type { TranslateRequest, TranslateResult } from '@/src/shared/messages';

vi.mock('wxt/browser', () => ({ browser: { runtime: { connect: vi.fn() } } }));

/** 假的 Port：记录监听器与已发出的消息，供测试触发消息/断开事件 */
function fakePort() {
  const listeners: { message?: (m: unknown) => void; disconnect?: () => void } = {};
  const posted: unknown[] = [];
  return {
    postMessage: (m: unknown) => posted.push(m),
    onMessage: { addListener: (fn: (m: unknown) => void) => (listeners.message = fn) },
    onDisconnect: { addListener: (fn: () => void) => (listeners.disconnect = fn) },
    posted,
    emit: (m: unknown) => listeners.message!(m),
    disconnect: () => listeners.disconnect!(),
  };
}

const connect = vi.mocked(browser.runtime.connect);
const req = (pageTitle: string): TranslateRequest => ({ type: 'translate', pageTitle, items: [] });

describe('createLlmChannel', () => {
  beforeEach(() => connect.mockReset());

  it('首次 send 才懒连接，带上 PORT_NAME，并转发消息', () => {
    const port = fakePort();
    connect.mockReturnValue(port as unknown as ReturnType<typeof browser.runtime.connect>);
    const channel = createLlmChannel(() => {});

    channel.send(req('T'));

    expect(connect).toHaveBeenCalledWith({ name: PORT_NAME });
    expect(port.posted).toEqual([req('T')]);
  });

  it('同一端口持续复用，不重复连接', () => {
    const port = fakePort();
    connect.mockReturnValue(port as unknown as ReturnType<typeof browser.runtime.connect>);
    const channel = createLlmChannel(() => {});

    channel.send(req('T1'));
    channel.send(req('T2'));

    expect(connect).toHaveBeenCalledTimes(1);
    expect(port.posted).toEqual([req('T1'), req('T2')]);
  });

  it('收到合法翻译结果时回调；非法消息被忽略', () => {
    const port = fakePort();
    connect.mockReturnValue(port as unknown as ReturnType<typeof browser.runtime.connect>);
    const results: TranslateResult[] = [];
    const channel = createLlmChannel((r) => results.push(r));
    channel.send(req('T'));

    port.emit({ type: 'result', id: '1', text: '你好' });
    port.emit({ type: 'nonsense' });

    expect(results).toEqual([{ type: 'result', id: '1', text: '你好' }]);
  });

  it('断开连接后下次 send 会重新连接', () => {
    const port1 = fakePort();
    const port2 = fakePort();
    connect
      .mockReturnValueOnce(port1 as unknown as ReturnType<typeof browser.runtime.connect>)
      .mockReturnValueOnce(port2 as unknown as ReturnType<typeof browser.runtime.connect>);
    const channel = createLlmChannel(() => {});

    channel.send(req('T1'));
    port1.disconnect();
    channel.send(req('T2'));

    expect(connect).toHaveBeenCalledTimes(2);
    expect(port2.posted).toEqual([req('T2')]);
  });
});
