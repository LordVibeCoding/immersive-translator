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
  await expect(page.locator('#p2')).toHaveText('译:Hello world, this is a test.', { useInnerText: true });
  await expect(page.locator('#p2 > it-tr')).toBeHidden();
});

test('只看译文：原地替换文字，不破坏表单控件与布局，切回后恢复原文', async ({ context, sw, server }) => {
  await configure(sw, server);
  const page = await context.newPage();
  await page.goto(server.url);
  await expect(page.locator('#dns it-tr')).toHaveCount(2);
  await sendCommand(sw, server.url, 'toggle');
  const before = await page.locator('#edit').boundingBox();
  await sendCommand(sw, server.url, 'toggle');

  await sendCommand(sw, server.url, 'toggle-mode');
  await expect(page.locator('html')).toHaveClass(/it-only/);
  await expect(page.locator('#type-cell .lbl')).toHaveText('译:Type');
  await expect(page.locator('#sel')).toBeVisible();
  await expect(page.locator('#host')).toBeVisible();
  await expect(page.locator('#host')).toHaveValue('@');
  await expect(page.locator('#edit')).toContainText('译:');
  await expect(page.locator('#dns it-tr').first()).toBeHidden();
  const after = await page.locator('#edit').boundingBox();
  // 中文字体行高略大（约 +3px）属正常；旧实现插入整行译文块会让按钮高度接近翻倍
  expect(after!.height).toBeLessThan(before!.height * 1.3);

  await sendCommand(sw, server.url, 'toggle-mode');
  await expect(page.locator('#type-cell .lbl')).toHaveText('Type');
  await expect(page.locator('#edit')).toHaveText('✎ Edit译:✎ Edit');
});

test('多个标签页互不影响：在 B 页操作不改变 A 页', async ({ context, sw, server }) => {
  await configure(sw, server);
  const pageA = await context.newPage();
  await pageA.goto(`${server.url}/a`);
  await expect(pageA.locator('#p1 > it-tr')).toHaveText(P1);
  const pageB = await context.newPage();
  await pageB.goto(`${server.url}/b`);
  await expect(pageB.locator('#p1 > it-tr')).toHaveText(P1);

  await sendCommand(sw, `${server.url}/b`, 'toggle');
  await expect(pageB.locator('html')).not.toHaveClass(/\bit-on\b/);
  await expect(pageA.locator('html')).toHaveClass(/\bit-on\b/);

  // 未开启翻译的页面上切换模式：本页开启并切到只看译文，A 页保持双语
  await sendCommand(sw, `${server.url}/b`, 'toggle-mode');
  await expect(pageB.locator('html')).toHaveClass(/\bit-on\b/);
  await expect(pageB.locator('html')).toHaveClass(/it-only/);
  await expect(pageA.locator('html')).not.toHaveClass(/it-only/);
});

test('悬浮球：单击开关本页翻译，菜单切换模式、隐藏后可通过设置恢复', async ({ context, sw, server }) => {
  await configure(sw, server);
  const page = await context.newPage();
  await page.goto(server.url);
  await expect(page.locator('#p1 > it-tr')).toHaveText(P1);

  const ball = page.locator('it-ball .ball');
  await expect(ball).toBeVisible();
  await ball.click();
  await expect(page.locator('html')).not.toHaveClass(/\bit-on\b/);
  await expect(ball).toHaveClass(/off/);
  await ball.click();
  await expect(page.locator('html')).toHaveClass(/\bit-on\b/);

  await ball.hover();
  await page.locator('it-ball [data-act="mode"]').click();
  await expect(page.locator('html')).toHaveClass(/it-only/);

  await ball.hover();
  await page.locator('it-ball [data-act="hide"]').click();
  await expect(page.locator('it-ball')).toHaveCount(0);
  // 等同于右键菜单「本站显示 / 隐藏悬浮球」：改设置后悬浮球恢复
  await sw.evaluate(async () => {
    const chrome = (globalThis as any).chrome;
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, ballHiddenSites: [] } });
  });
  await expect(page.locator('it-ball .ball')).toBeVisible();
});

test('清单包含右键菜单权限与插件图标', async ({ context, sw }) => {
  void context;
  const manifest = await sw.evaluate(() => (globalThis as any).chrome.runtime.getManifest());
  expect(manifest.permissions).toContain('contextMenus');
  expect(manifest.icons?.['128']).toBeTruthy();
});

test('只看译文：混合块的子段落保持可见并在滚动到后被原地翻译', async ({ context, sw, server }) => {
  await configure(sw, server);
  const page = await context.newPage();
  await page.goto(server.url);
  await expect(page.locator('#mix > it-tr')).toHaveText('译:Lead text');
  await expect(page.locator('#mixp > it-tr')).toHaveCount(0);

  await sendCommand(sw, server.url, 'toggle-mode');
  await expect(page.locator('html')).toHaveClass(/it-only/);
  await expect(page.locator('#mix')).toContainText('译:Lead text', { useInnerText: true });
  await expect(page.locator('#mixp')).toBeVisible();

  await page.locator('#mixp').scrollIntoViewIfNeeded();
  await expect(page.locator('#mixp')).toHaveText('译:Child paragraph text.', { useInnerText: true });
  await expect(page.locator('#mixp')).toHaveCSS('font-size', '16px');
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
