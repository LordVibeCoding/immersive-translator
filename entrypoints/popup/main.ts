import { browser } from 'wxt/browser';
import { downloadLocalModel, localAvailability, type LocalAvailability } from '@/src/content/local-engine';
import { LAST_ERROR_KEY } from '@/src/shared/constants';
import type { PageState, TabCommand } from '@/src/shared/messages';
import { isLlmConfigured, loadSettings, saveSettings, toggleNeverSite } from '@/src/shared/settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const LOCAL_TEXT: Record<LocalAvailability, string> = {
  available: '✅ 已就绪',
  downloadable: '⬇️ 模型未下载',
  downloading: '⏳ 正在下载…',
  unavailable: '❌ 当前设备不支持英译中',
  unsupported: '❌ 浏览器不支持（需要 Chrome 138+）',
};

async function sendToTab(tabId: number | undefined, command: TabCommand): Promise<PageState | null> {
  if (tabId === undefined) return null;
  try {
    return (await browser.tabs.sendMessage(tabId, command)) as PageState;
  } catch {
    return null; // 内容脚本不存在：内部页面或尚未加载
  }
}

function renderState(state: PageState | null): void {
  $('unsupported').hidden = state !== null;
  $('controls').hidden = state === null;
  if (!state) return;
  $('host').textContent = state.hostname;
  $('toggle').textContent = state.enabled ? '关闭翻译' : '开启翻译';
  $('mode').textContent = state.mode === 'dual' ? '切换为：只看译文' : '切换为：双语对照';
}

async function renderLocal(): Promise<void> {
  const status = await localAvailability();
  $('local-status').textContent = LOCAL_TEXT[status];
  $('download').hidden = status !== 'downloadable';
}

async function renderLlm(): Promise<void> {
  const { llm } = await loadSettings();
  $('llm-status').textContent = isLlmConfigured(llm) ? `✅ ${llm.model}` : '未配置（只使用本地翻译）';
  const stored = await browser.storage.session.get(LAST_ERROR_KEY);
  const lastError = stored[LAST_ERROR_KEY] as { message: string; at: number } | undefined;
  $('error').hidden = !lastError;
  if (lastError) {
    $('error').textContent = `最近错误（${new Date(lastError.at).toLocaleTimeString()}）：${lastError.message}`;
  }
}

async function downloadModel(): Promise<void> {
  $('download').hidden = true;
  try {
    await downloadLocalModel((ratio) => {
      $('local-status').textContent = `⏳ 下载中 ${Math.round(ratio * 100)}%`;
    });
    $('local-status').textContent = '✅ 已就绪（刷新网页后生效）';
  } catch (err) {
    $('local-status').textContent = `下载失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

async function main(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const state = await sendToTab(tab?.id, { type: 'get-state' });
  renderState(state);
  if (state) {
    $<HTMLInputElement>('never').checked = (await loadSettings()).neverSites.includes(state.hostname);
  }

  $('toggle').addEventListener('click', async () => renderState(await sendToTab(tab?.id, { type: 'toggle' })));
  $('mode').addEventListener('click', async () => renderState(await sendToTab(tab?.id, { type: 'toggle-mode' })));
  $('never').addEventListener('change', async () => {
    if (!state) return;
    const { neverSites } = await loadSettings();
    await saveSettings({ neverSites: toggleNeverSite(neverSites, state.hostname) });
  });
  $('download').addEventListener('click', () => void downloadModel());
  $('options').addEventListener('click', (e) => {
    e.preventDefault();
    void browser.runtime.openOptionsPage();
  });

  await Promise.all([renderLocal(), renderLlm()]);
}

void main();
