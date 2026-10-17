import { browser } from 'wxt/browser';
import { createSemaphore } from '@/src/background/batching';
import { createIdbCache } from '@/src/background/cache';
import { streamTranslate } from '@/src/background/llm-client';
import { handlePort, type PortLike } from '@/src/background/port-handler';
import { LAST_ERROR_KEY, MAX_CONCURRENT_REQUESTS, PORT_NAME } from '@/src/shared/constants';
import type { TabCommand } from '@/src/shared/messages';
import { loadSettings } from '@/src/shared/settings';

const COMMAND_MESSAGES: Record<string, TabCommand> = {
  'toggle-translate': { type: 'toggle' },
  'toggle-mode': { type: 'toggle-mode' },
};

export default defineBackground(() => {
  const cache = createIdbCache();
  const semaphore = createSemaphore(MAX_CONCURRENT_REQUESTS);

  const reportError = (message: string) => {
    console.warn('[沉浸翻译] 精翻失败', message);
    void browser.storage.session.set({ [LAST_ERROR_KEY]: { message, at: Date.now() } });
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    handlePort(port as unknown as PortLike, {
      getConfig: async () => (await loadSettings()).llm,
      cache,
      semaphore,
      translate: streamTranslate,
      reportError,
    });
  });

  browser.commands.onCommand.addListener(async (command) => {
    const message = COMMAND_MESSAGES[command];
    if (!message) return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    await browser.tabs.sendMessage(tab.id, message).catch((err: unknown) => {
      console.warn('[沉浸翻译] 当前页面无法接收快捷键（可能是浏览器内部页面）', err);
    });
  });
});
