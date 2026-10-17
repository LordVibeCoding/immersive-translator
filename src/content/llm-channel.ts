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
    /** 扩展重载后（Extension context invalidated）或端口刚断开时 connect/postMessage 会同步抛错，
     *  此时丢弃端口，下次发送重连；本批不重发（保留本地初稿） */
    send(request: TranslateRequest): void {
      try {
        port ??= connect();
        port.postMessage(request);
      } catch (err) {
        port = null;
        console.warn('[沉浸翻译] 发送大模型请求失败', err);
      }
    },
  };
}
