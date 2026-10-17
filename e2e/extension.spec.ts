import path from 'node:path';
import { chromium, expect, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { startMockServer, type MockServer } from './mock-server';

const EXTENSION_PATH = path.resolve('.output/chrome-mv3');

const test = base.extend<{ server: MockServer; context: BrowserContext; sw: Worker }>({
  server: async ({}, use) => {
    const server = await startMockServer();
    await use(server);
    await server.close();
  },
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    await use(context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')));
  },
});

async function configure(sw: Worker, server: MockServer): Promise<void> {
  const settings = {
    llm: { baseURL: `${server.url}/v1`, apiKey: 'test-key', model: 'mock' },
    autoTranslate: true,
    neverSites: [],
    mode: 'dual',
  };
  await sw.evaluate(async (s) => {
    await (globalThis as any).chrome.storage.local.set({ settings: s });
  }, settings);
}

/** 模拟快捷键：后台给测试页所在标签页发命令 */
async function sendCommand(sw: Worker, pageUrl: string, type: string): Promise<void> {
  await sw.evaluate(
    async ({ url, type }) => {
      const chrome = (globalThis as any).chrome;
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t: { url?: string }) => t.url?.startsWith(url));
      await chrome.tabs.sendMessage(tab.id, { type });
    },
    { url: pageUrl, type },
  );
}

const P1 = '译:The quick brown fox jumps over the lazy dog.';

test('自动翻译可见段落，跳过代码块', async ({ context, sw, server }) => {
  await configure(sw, server);
  const page = await context.newPage();
  await page.goto(server.url);
  await expect(page.locator('#p1 > it-tr')).toHaveText(P1);
  await expect(page.locator('#p2 > it-tr')).toHaveText('译:Hello world, this is a test.');
  await expect(page.locator('#code it-tr')).toHaveCount(0);
});

test('开关翻译、切换只看译文', async ({ context, sw, server }) => {
  await configure(sw, server);
  const page = await context.newPage();
  await page.goto(server.url);
  await expect(page.locator('#p1 > it-tr')).toHaveText(P1);

  await sendCommand(sw, server.url, 'toggle');
  await expect(page.locator('#p1 > it-tr')).toBeHidden();
  await sendCommand(sw, server.url, 'toggle');
  await expect(page.locator('#p1 > it-tr')).toBeVisible();

  await sendCommand(sw, server.url, 'toggle-mode');
  await expect(page.locator('html')).toHaveClass(/it-only/);
  await expect(page.locator('#p2 > a')).toBeHidden();
  await expect(page.locator('#p2 > it-tr')).toBeVisible();
});

test('只看译文：混合块的子段落保持可见并在滚动到后被翻译', async ({ context, sw, server }) => {
  await configure(sw, server);
  const page = await context.newPage();
  await page.goto(server.url);
  await expect(page.locator('#mix > it-tr')).toHaveText('译:Lead text');
  await expect(page.locator('#mixp > it-tr')).toHaveCount(0);

  await sendCommand(sw, server.url, 'toggle-mode');
  await expect(page.locator('html')).toHaveClass(/it-only/);
  await expect(page.locator('#mix')).toHaveCSS('font-size', '0px');
  await expect(page.locator('#mix > it-tr')).toBeVisible();
  await expect(page.locator('#mixp')).toBeVisible();

  await page.locator('#mixp').scrollIntoViewIfNeeded();
  await expect(page.locator('#mixp > it-tr')).toHaveText('译:Child paragraph text.');
  await expect(page.locator('#mixp > it-tr')).toHaveCSS('font-size', '16px');
});

test('动态插入的段落也会被翻译', async ({ context, sw, server }) => {
  await configure(sw, server);
  const page = await context.newPage();
  await page.goto(server.url);
  await expect(page.locator('#p1 > it-tr')).toHaveText(P1);
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'p3';
    p.textContent = 'Dynamically added paragraph.';
    document.body.prepend(p); // 插到顶部，保证在视口内（页面底部有高占位）
  });
  await expect(page.locator('#p3 > it-tr')).toHaveText('译:Dynamically added paragraph.');
});

test('刷新后命中缓存，不再请求大模型', async ({ context, sw, server }) => {
  await configure(sw, server);
  const page = await context.newPage();
  await page.goto(server.url);
  await expect(page.locator('#p2 > it-tr')).toHaveText('译:Hello world, this is a test.');
  const before = server.llmRequests();
  await page.reload();
  await expect(page.locator('#p1 > it-tr')).toHaveText(P1);
  await expect(page.locator('#p2 > it-tr')).toHaveText('译:Hello world, this is a test.');
  expect(server.llmRequests()).toBe(before);
});

test('设置页保存大模型配置', async ({ context, sw }) => {
  const extensionId = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.fill('#baseURL', 'https://api.example.com/v1');
  await page.fill('#apiKey', 'sk-xxx');
  await page.fill('#model', 'fast');
  await page.click('button[type=submit]');
  await expect(page.locator('#status')).toHaveText('已保存，刷新网页后生效');
  const saved = await sw.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('settings')).settings);
  expect(saved.llm).toEqual({ baseURL: 'https://api.example.com/v1', apiKey: 'sk-xxx', model: 'fast' });
});
