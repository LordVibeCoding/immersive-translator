import { browser } from 'wxt/browser';
import { PORT_NAME } from '../shared/constants';
import { isTranslateResult, type TranslateRequest, type TranslateResult } from '../shared/messages';

type Port = ReturnType<typeof browser.runtime.connect>;

/** 懒连接后台；Service Worker 被回收导致断开时，下次发送自动重连 */
export function createLlmChannel(onResult: (result: TranslateResult) => void) {
  let port: Port | null = null;

  const connect = (): Port => {
    const next = browser.runtime.connect({ name: PORT_NAME });
    next.onMessage.addListener((message: unknown) => {
      if (isTranslateResult(message)) onResult(message);
    });
    next.onDisconnect.addListener(() => {
      port = null;
    });
    return next;
  };

  return {
    send(request: TranslateRequest): void {
      port ??= connect();
      port.postMessage(request);
    },
  };
}
