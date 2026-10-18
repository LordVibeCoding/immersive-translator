import { browser } from 'wxt/browser';
import { mountFloatingBall, type BallMount } from '@/src/content/ball-mount';
import { Controller, type CreateVisibilityObserver } from '@/src/content/controller';
import { createLlmChannel } from '@/src/content/llm-channel';
import { createLocalEngineOnGesture } from '@/src/content/local-engine';
import { applyTabCommand } from '@/src/content/tab-commands';
import { isEnglishPage } from '@/src/content/text-filter';
import { PAGE_SAMPLE_CHARS, VIEWPORT_ROOT_MARGIN } from '@/src/shared/constants';
import { isTabCommand, type PageState } from '@/src/shared/messages';
import {
  isLlmConfigured,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_KEY,
  shouldAutoTranslate,
} from '@/src/shared/settings';

const createVisibility: CreateVisibilityObserver = (onVisible) => {
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).map((e) => e.target);
      visible.forEach((el) => io.unobserve(el));
      if (visible.length > 0) onVisible(visible);
    },
    { rootMargin: VIEWPORT_ROOT_MARGIN },
  );
  return { observe: (el) => io.observe(el), disconnect: () => io.disconnect() };
};

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    const settings = await loadSettings();
    let hasLocalEngine = false;
    let ball: BallMount | null = null;
    const channel = createLlmChannel((result) => controller.handleResult(result.id, result.text));
    const controller = new Controller({
      doc: document,
      local: null,
      llmEnabled: isLlmConfigured(settings.llm),
      mode: settings.mode,
      sendToLlm: (request) => channel.send(request),
      createVisibilityObserver: createVisibility,
    });

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isTabCommand(message)) return;
      applyTabCommand(controller, message, (mode) => void saveSettings({ mode }));
      ball?.refresh();
      const state: PageState = { ...controller.state, hostname: location.hostname, localEngine: hasLocalEngine };
      sendResponse(state);
    });

    // 站点名单、悬浮球位置变化时同步悬浮球（模式不跨标签页同步）
    browser.storage.onChanged.addListener((changes, area) => {
      const change = changes[SETTINGS_KEY];
      if (area === 'local' && change) ball?.applySettings(normalizeSettings(change.newValue));
    });

    // 放在监听注册之后，不阻塞 popup/快捷键消息；模型对本站已就绪时等创建完成再开启，让首批段落用上本地初稿，
    // 否则等页面上第一次点击/按键再创建（见 createLocalEngineOnGesture）
    await createLocalEngineOnGesture((engine) => {
      hasLocalEngine = true;
      controller.setLocalEngine(engine);
    });

    const sample = (document.body?.textContent ?? '').slice(0, PAGE_SAMPLE_CHARS);
    if (shouldAutoTranslate(settings, location.hostname) && isEnglishPage(document.documentElement.lang, sample)) {
      controller.enable();
    }
    ball = mountFloatingBall(controller, settings, location.hostname);
  },
});
