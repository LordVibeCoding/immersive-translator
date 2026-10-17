# 自用沉浸式翻译插件 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 做一个 Chrome MV3 插件，英文网页「本地秒出初稿 + 大模型流式精翻」，支持关闭 / 双语对照 / 只看译文一键切换。

**Architecture：** 内容脚本负责找段落（视口优先）、调 Chrome 内置 Translator API 出初稿、渲染与模式切换；后台 Service Worker 负责 OpenAI 兼容接口的攒批流式精翻、IndexedDB 缓存和全局并发控制；两者通过 `chrome.runtime` 长连接通信。

**Tech Stack：** TypeScript、WXT 0.21（MV3 框架）、idb-keyval、Vitest 5 + happy-dom + fake-indexeddb、Playwright。

**Spec：** `docs/superpowers/specs/2026-10-18-immersive-translator-design.md`

## Global Constraints

- 浏览器：仅正版 Chrome 138+（Translator API）；翻译方向固定 `en` → `zh`
- 所有注释、界面文案、commit message 用中文；commit 格式 `<type>: <描述>`
- 不引入 UI 框架；运行时依赖只有 `idb-keyval`
- 所有可调参数集中在 `src/shared/constants.ts`，不在业务代码里写魔法数字
- TypeScript strict（继承 `.wxt/tsconfig.json`）；单文件 ≤ 400 行，函数 < 50 行
- 数据对象用 `readonly` + 返回新对象，不原地修改（DOM 操作除外）
- 错误不静默吞掉：至少 `console.warn('[沉浸翻译] …', err)` 或上报到 popup
- `src/` 下逻辑模块单测覆盖率 ≥ 80%

## 文件结构

```
package.json / wxt.config.ts / tsconfig.json / vitest.config.ts / playwright.config.ts / .gitignore
src/shared/constants.ts        所有可调参数
src/shared/settings.ts         设置类型、默认值、校验、读写
src/shared/messages.ts         消息类型与类型守卫
src/content/text-filter.ts     段落是否需要翻译、页面是否英文
src/content/scanner.ts         找段落块、读取段落自身文字与插入锚点
src/content/renderer.ts        渲染译文、质量等级、显示模式样式
src/content/local-engine.ts    Chrome Translator API 封装
src/content/controller.ts      内容脚本编排（开关/模式/视口/动态内容/双引擎）
src/content/llm-channel.ts     到后台的长连接（断线自动重连）
src/background/stream-parser.ts SSE 解码 + 「[编号] 译文」切分
src/background/llm-client.ts   OpenAI 兼容流式请求
src/background/batching.ts     攒批器 + 信号量
src/background/cache.ts        IndexedDB 缓存
src/background/port-handler.ts 处理一个标签页的长连接
entrypoints/background.ts      后台入口（长连接、快捷键）
entrypoints/content.ts         内容脚本入口
entrypoints/popup/*            弹窗
entrypoints/options/*          设置页
tests/**                       单元/集成测试（镜像 src 目录）
e2e/*                          Playwright 端到端测试 + 模拟大模型服务
```

---

### Task 1: 项目脚手架 + 常量 + 设置模块

**Files:**
- Create: `package.json`、`wxt.config.ts`、`tsconfig.json`、`vitest.config.ts`、`.gitignore`
- Create: `entrypoints/background.ts`（占位，Task 12 替换）
- Create: `src/shared/constants.ts`、`src/shared/settings.ts`
- Test: `tests/shared/settings.test.ts`

**Interfaces:**
- Produces:
  - `constants.ts` 导出：`SOURCE_LANG, TARGET_LANG, MIN_TEXT_LENGTH, MAX_CJK_RATIO, ENGLISH_PAGE_MIN_LATIN_RATIO, PAGE_SAMPLE_CHARS, VIEWPORT_ROOT_MARGIN, CONTENT_FLUSH_MS, MUTATION_DEBOUNCE_MS, BATCH_MAX_ITEMS, BATCH_MAX_CHARS, BATCH_WAIT_MS, MAX_CONCURRENT_REQUESTS, PORT_NAME, LAST_ERROR_KEY, TR_TAG`
  - `settings.ts` 导出：`type DisplayMode = 'dual' | 'only'`、`interface LlmConfig {baseURL; apiKey; model}`、`interface Settings {llm; autoTranslate; neverSites; mode}`、`SETTINGS_KEY`、`DEFAULT_SETTINGS`、`normalizeSettings(raw: unknown): Settings`、`isLlmConfigured(llm): boolean`、`isValidBaseURL(url): boolean`、`shouldAutoTranslate(settings, hostname): boolean`、`toggleNeverSite(sites, hostname): string[]`、`loadSettings(): Promise<Settings>`、`saveSettings(patch: Partial<Settings>): Promise<Settings>`

- [ ] **Step 1: 写配置文件**

`package.json`：

```json
{
  "name": "immersive-translator",
  "description": "自用沉浸式翻译插件",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "wxt build && playwright test",
    "postinstall": "wxt prepare"
  }
}
```

`wxt.config.ts`：

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '沉浸翻译（自用）',
    description: '英文网页双语对照：本地翻译秒出初稿，大模型后台精翻',
    permissions: ['storage'],
    host_permissions: ['<all_urls>'],
    commands: {
      'toggle-translate': { suggested_key: { default: 'Alt+A' }, description: '开关当前页翻译' },
      'toggle-mode': { suggested_key: { default: 'Alt+S' }, description: '切换双语对照 / 只看译文' },
    },
  },
});
```

`tsconfig.json`：

```json
{
  "extends": "./.wxt/tsconfig.json"
}
```

`vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 },
    },
  },
});
```

`.gitignore`：

```
node_modules
.output
.wxt
web-ext.config.ts
coverage
test-results
playwright-report
.DS_Store
*.log
```

`entrypoints/background.ts`（占位）：

```ts
export default defineBackground(() => {});
```

- [ ] **Step 2: 安装依赖**

Run:
```bash
pnpm add idb-keyval
pnpm add -D wxt typescript@^5.9.3 vite vitest @vitest/coverage-v8 happy-dom fake-indexeddb @playwright/test
```
Expected: 安装成功，postinstall 生成 `.wxt/` 目录。

- [ ] **Step 3: 写常量**

`src/shared/constants.ts`：

```ts
/** 翻译方向（固定英译中） */
export const SOURCE_LANG = 'en';
export const TARGET_LANG = 'zh';

/** 段落过滤 */
export const MIN_TEXT_LENGTH = 3;
/** 中日韩字符数 / (中日韩字符数 + 英文单词数) 超过该值视为已是中文 */
export const MAX_CJK_RATIO = 0.3;
/** 无 lang 属性时，拉丁字母占比达到该值视为英文页面 */
export const ENGLISH_PAGE_MIN_LATIN_RATIO = 0.5;
export const PAGE_SAMPLE_CHARS = 2000;

/** 内容脚本调度 */
export const VIEWPORT_ROOT_MARGIN = '100% 0px';
export const CONTENT_FLUSH_MS = 50;
export const MUTATION_DEBOUNCE_MS = 300;

/** 后台大模型批处理 */
export const BATCH_MAX_ITEMS = 20;
export const BATCH_MAX_CHARS = 2500;
export const BATCH_WAIT_MS = 150;
export const MAX_CONCURRENT_REQUESTS = 3;

/** 通信、存储与 DOM 标记 */
export const PORT_NAME = 'translate';
export const LAST_ERROR_KEY = 'lastError';
export const TR_TAG = 'it-tr';
```

- [ ] **Step 4: 写失败测试**

`tests/shared/settings.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  isLlmConfigured,
  isValidBaseURL,
  loadSettings,
  normalizeSettings,
  saveSettings,
  shouldAutoTranslate,
  toggleNeverSite,
} from '@/src/shared/settings';

describe('normalizeSettings', () => {
  it('空值返回默认设置', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('非法字段回落默认值，字符串去首尾空白', () => {
    const s = normalizeSettings({
      mode: 'weird',
      autoTranslate: 'yes',
      neverSites: ['a.com', 1],
      llm: { baseURL: ' https://x.com/v1 ', apiKey: 5 },
    });
    expect(s.mode).toBe('dual');
    expect(s.autoTranslate).toBe(true);
    expect(s.neverSites).toEqual(['a.com']);
    expect(s.llm).toEqual({ baseURL: 'https://x.com/v1', apiKey: '', model: '' });
  });

  it('保留合法值', () => {
    const s = normalizeSettings({ mode: 'only', autoTranslate: false });
    expect(s.mode).toBe('only');
    expect(s.autoTranslate).toBe(false);
  });
});

describe('isLlmConfigured', () => {
  it('三项都填才算配置', () => {
    expect(isLlmConfigured({ baseURL: 'https://a', apiKey: 'k', model: 'm' })).toBe(true);
    expect(isLlmConfigured({ baseURL: 'https://a', apiKey: '', model: 'm' })).toBe(false);
  });
});

describe('isValidBaseURL', () => {
  it('只接受 http/https', () => {
    expect(isValidBaseURL('https://api.deepseek.com/v1')).toBe(true);
    expect(isValidBaseURL('http://127.0.0.1:8080/v1')).toBe(true);
    expect(isValidBaseURL('ftp://x')).toBe(false);
    expect(isValidBaseURL('not a url')).toBe(false);
  });
});

describe('站点规则', () => {
  it('自动翻译开启且不在黑名单时才自动翻译', () => {
    const s = { ...DEFAULT_SETTINGS, neverSites: ['b.com'] };
    expect(shouldAutoTranslate(s, 'a.com')).toBe(true);
    expect(shouldAutoTranslate(s, 'b.com')).toBe(false);
    expect(shouldAutoTranslate({ ...s, autoTranslate: false }, 'a.com')).toBe(false);
  });

  it('toggleNeverSite 返回新数组且不修改入参', () => {
    const sites = ['a.com'];
    expect(toggleNeverSite(sites, 'b.com')).toEqual(['a.com', 'b.com']);
    expect(toggleNeverSite(sites, 'a.com')).toEqual([]);
    expect(sites).toEqual(['a.com']);
  });
});

describe('loadSettings / saveSettings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('未保存时读到默认值', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('保存部分字段后可读回，其余保持默认', async () => {
    const saved = await saveSettings({ mode: 'only' });
    expect(saved.mode).toBe('only');
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, mode: 'only' });
    expect(DEFAULT_SETTINGS.mode).toBe('dual');
  });
});
```

- [ ] **Step 5: 运行测试确认失败**

Run: `pnpm test tests/shared/settings.test.ts`
Expected: FAIL，提示找不到 `@/src/shared/settings`

- [ ] **Step 6: 实现设置模块**

`src/shared/settings.ts`：

```ts
import { browser } from 'wxt/browser';

export type DisplayMode = 'dual' | 'only';

export interface LlmConfig {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;
}

export interface Settings {
  readonly llm: LlmConfig;
  readonly autoTranslate: boolean;
  readonly neverSites: readonly string[];
  readonly mode: DisplayMode;
}

export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  llm: { baseURL: '', apiKey: '', model: '' },
  autoTranslate: true,
  neverSites: [],
  mode: 'dual',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asTrimmedString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

/** 校验从存储读出的数据，非法字段回落到默认值 */
export function normalizeSettings(raw: unknown): Settings {
  const obj = asRecord(raw);
  const llm = asRecord(obj.llm);
  const d = DEFAULT_SETTINGS;
  return {
    llm: {
      baseURL: asTrimmedString(llm.baseURL, d.llm.baseURL),
      apiKey: asTrimmedString(llm.apiKey, d.llm.apiKey),
      model: asTrimmedString(llm.model, d.llm.model),
    },
    autoTranslate: typeof obj.autoTranslate === 'boolean' ? obj.autoTranslate : d.autoTranslate,
    neverSites: Array.isArray(obj.neverSites)
      ? obj.neverSites.filter((s): s is string => typeof s === 'string')
      : d.neverSites,
    mode: obj.mode === 'dual' || obj.mode === 'only' ? obj.mode : d.mode,
  };
}

export function isLlmConfigured(llm: LlmConfig): boolean {
  return Boolean(llm.baseURL && llm.apiKey && llm.model);
}

export function isValidBaseURL(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function shouldAutoTranslate(settings: Settings, hostname: string): boolean {
  return settings.autoTranslate && !settings.neverSites.includes(hostname);
}

export function toggleNeverSite(sites: readonly string[], hostname: string): string[] {
  return sites.includes(hostname) ? sites.filter((s) => s !== hostname) : [...sites, hostname];
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
```

- [ ] **Step 7: 运行测试、类型检查、构建**

Run: `pnpm test tests/shared/settings.test.ts && pnpm compile && pnpm build`
Expected: 测试全部 PASS；tsc 无错误；构建产物在 `.output/chrome-mv3/`，`manifest.json` 中有 `commands` 两项。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "chore: 搭建 WXT 项目骨架，新增常量与设置模块"
```

---

### Task 2: 文本过滤（text-filter）

**Files:**
- Create: `src/content/text-filter.ts`
- Test: `tests/content/text-filter.test.ts`

**Interfaces:**
- Consumes: `MIN_TEXT_LENGTH, MAX_CJK_RATIO, ENGLISH_PAGE_MIN_LATIN_RATIO`（constants）
- Produces: `normalizeText(text: string): string`、`shouldTranslate(text: string): boolean`、`isEnglishPage(htmlLang: string, sample: string): boolean`

- [ ] **Step 1: 写失败测试**

`tests/content/text-filter.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { isEnglishPage, normalizeText, shouldTranslate } from '@/src/content/text-filter';

describe('normalizeText', () => {
  it('折叠空白并去除首尾空格', () => {
    expect(normalizeText('  a \n\t b  ')).toBe('a b');
  });
});

describe('shouldTranslate', () => {
  it.each([
    ['The quick brown fox.', true],
    ['Install with npm i foo', true],
    ['OK', false],
    ['   ', false],
    ['12,345.67 %', false],
    ['https://example.com/path', false],
    ['www.example.com', false],
    ['这是一段中文内容，夹杂 React 一词', false],
    ['使用 TypeScript 编写', false],
  ])('%s → %s', (text, expected) => {
    expect(shouldTranslate(text)).toBe(expected);
  });
});

describe('isEnglishPage', () => {
  it('有 lang 属性时以其为准', () => {
    expect(isEnglishPage('en-US', '中文内容')).toBe(true);
    expect(isEnglishPage(' EN ', '')).toBe(true);
    expect(isEnglishPage('zh-CN', 'English text')).toBe(false);
  });

  it('无 lang 时按拉丁字母占比判断', () => {
    expect(isEnglishPage('', 'Mostly English words here 一点')).toBe(true);
    expect(isEnglishPage('', '大部分都是中文内容 a')).toBe(false);
    expect(isEnglishPage('', '')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/content/text-filter.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`src/content/text-filter.ts`：

```ts
import { ENGLISH_PAGE_MIN_LATIN_RATIO, MAX_CJK_RATIO, MIN_TEXT_LENGTH } from '../shared/constants';

const LATIN_LETTER = /[A-Za-z]/g;
const LATIN_WORD = /[A-Za-z]+/g;
const CJK_CHAR = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;
const URL_ONLY = /^(https?:\/\/|www\.)\S+$/i;

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 判断一段文字是否值得翻译 */
export function shouldTranslate(raw: string): boolean {
  const text = normalizeText(raw);
  if (text.length < MIN_TEXT_LENGTH || URL_ONLY.test(text)) return false;
  const words = count(text, LATIN_WORD);
  if (words === 0) return false;
  const cjk = count(text, CJK_CHAR);
  return cjk / (cjk + words) <= MAX_CJK_RATIO;
}

/** 判断页面是否为英文：优先看 <html lang>，没有则按正文抽样的字母占比 */
export function isEnglishPage(htmlLang: string, sample: string): boolean {
  const lang = htmlLang.trim().toLowerCase();
  if (lang) return lang.startsWith('en');
  const latin = count(sample, LATIN_LETTER);
  const cjk = count(sample, CJK_CHAR);
  return latin > 0 && latin / (latin + cjk) >= ENGLISH_PAGE_MIN_LATIN_RATIO;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/content/text-filter.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/content/text-filter.ts tests/content/text-filter.test.ts
git commit -m "feat: 新增段落文本过滤与英文页面判断"
```

---

### Task 3: 段落扫描（scanner）

**Files:**
- Create: `src/content/scanner.ts`
- Test: `tests/content/scanner.test.ts`

**Interfaces:**
- Consumes: `normalizeText`（text-filter）、`TR_TAG`（constants）
- Produces:
  - `interface Unit { readonly block: Element; readonly text: string; readonly anchor: Node }` —— `anchor` 是段落块的直接子节点，译文插在它后面
  - `nearestBlock(el: Element): Element`
  - `findBlocks(root: Element): Element[]` —— root 子树内所有含有效文字的段落块（可能位于 root 之外的祖先）
  - `readUnit(block: Element): Unit | null` —— 只取「最近块就是自己」的文字

- [ ] **Step 1: 写失败测试**

`tests/content/scanner.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { findBlocks, readUnit } from '@/src/content/scanner';

const byId = (id: string) => document.getElementById(id)!;
const ids = (els: Element[]) => els.map((e) => e.id);

describe('scanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('段落内的行内元素归属于段落', () => {
    document.body.innerHTML = '<p id="p">Hello <a href="#">world</a> and <b>more</b>.</p>';
    expect(ids(findBlocks(document.body))).toEqual(['p']);
    expect(readUnit(byId('p'))?.text).toBe('Hello world and more.');
  });

  it('跳过代码块、可编辑区与 notranslate', () => {
    document.body.innerHTML =
      '<pre>code here</pre><div contenteditable="true">edit me</div>' +
      '<div class="notranslate">keep</div><p id="p">Real text</p>';
    expect(ids(findBlocks(document.body))).toEqual(['p']);
  });

  it('不把插件插入的译文当作原文', () => {
    document.body.innerHTML = '<p id="p">Hello there<it-tr>你好</it-tr></p>';
    expect(readUnit(byId('p'))?.text).toBe('Hello there');
  });

  it('混合块只取自身文字，锚点在嵌套块之前', () => {
    document.body.innerHTML = '<ul><li id="outer">Outer text <ul><li id="inner">Inner text</li></ul></li></ul>';
    expect(ids(findBlocks(document.body))).toEqual(['outer', 'inner']);
    const unit = readUnit(byId('outer'))!;
    expect(unit.text).toBe('Outer text');
    expect(unit.anchor).toBe(byId('outer').firstChild);
  });

  it('没有自身文字的块返回 null', () => {
    document.body.innerHTML = '<div id="d"><p>Only child</p></div>';
    expect(readUnit(byId('d'))).toBeNull();
  });

  it('Twitter 式 div>span 结构整体是一个段落', () => {
    document.body.innerHTML =
      '<div id="t" data-testid="tweetText"><span>Just shipped</span><span> a new feature</span></div>';
    expect(ids(findBlocks(document.body))).toEqual(['t']);
    expect(readUnit(byId('t'))?.text).toBe('Just shipped a new feature');
  });

  it('从段落内部节点开始扫描时仍返回外层段落', () => {
    document.body.innerHTML = '<p id="p">Hello <span id="s">dear <b>friend</b></span></p>';
    expect(ids(findBlocks(byId('s')))).toEqual(['p']);
  });

  it('锚点是包含最后一段文字的直接子节点', () => {
    document.body.innerHTML = '<p id="p">Read <a id="a" href="#">the docs</a></p>';
    expect(readUnit(byId('p'))?.anchor).toBe(byId('a'));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/content/scanner.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`src/content/scanner.ts`：

```ts
import { TR_TAG } from '../shared/constants';
import { normalizeText } from './text-filter';

/** 段落：块元素 + 它自身的文字 + 译文插入锚点 */
export interface Unit {
  readonly block: Element;
  readonly text: string;
  readonly anchor: Node;
}

const INLINE_TAGS = new Set([
  'A', 'B', 'STRONG', 'I', 'EM', 'SPAN', 'CODE', 'SMALL', 'SUP', 'SUB', 'MARK', 'ABBR',
  'TIME', 'LABEL', 'U', 'S', 'BR', 'IMG', 'FONT', 'CITE', 'Q',
]);

const SKIP_SELECTOR = [
  'pre', 'code', 'script', 'style', 'noscript', 'textarea', 'input', 'select', 'svg', 'math',
  '[contenteditable=""]', '[contenteditable="true"]', '[translate="no"]', '.notranslate', TR_TAG,
].join(',');

/** 向上跳过行内元素，返回最近的块级祖先（含自身） */
export function nearestBlock(el: Element): Element {
  let current = el;
  while (INLINE_TAGS.has(current.tagName) && current.parentElement) current = current.parentElement;
  return current;
}

function isCandidateText(node: Node): boolean {
  const parent = node.parentElement;
  return Boolean(parent && node.textContent?.trim() && !parent.closest(SKIP_SELECTOR));
}

function candidateTextNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isCandidateText(node)) nodes.push(node as Text);
  }
  return nodes;
}

export function findBlocks(root: Element): Element[] {
  return [...new Set(candidateTextNodes(root).map((n) => nearestBlock(n.parentElement!)))];
}

function directChildOf(block: Element, node: Node): Node {
  let current = node;
  while (current.parentNode && current.parentNode !== block) current = current.parentNode;
  return current;
}

export function readUnit(block: Element): Unit | null {
  const own = candidateTextNodes(block).filter((n) => nearestBlock(n.parentElement!) === block);
  const last = own.at(-1);
  if (!last) return null;
  return {
    block,
    text: normalizeText(own.map((n) => n.textContent ?? '').join('')),
    anchor: directChildOf(block, last),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/content/scanner.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/content/scanner.ts tests/content/scanner.test.ts
git commit -m "feat: 新增段落扫描，支持行内结构与嵌套块"
```

---

### Task 4: 译文渲染与显示模式（renderer）

**Files:**
- Create: `src/content/renderer.ts`
- Test: `tests/content/renderer.test.ts`

**Interfaces:**
- Consumes: `Unit`（scanner）、`TR_TAG`（constants）、`DisplayMode`（settings）
- Produces: `type Level = 'draft' | 'final'`、`renderTranslation(unit: Unit, text: string, level: Level): boolean`（返回是否实际渲染）、`isRendered(block: Element): boolean`、`clearTranslation(block: Element): void`、`applyMode(doc: Document, enabled: boolean, mode: DisplayMode): void`、`injectStyles(doc: Document): void`

- [ ] **Step 1: 写失败测试**

`tests/content/renderer.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMode,
  clearTranslation,
  injectStyles,
  isRendered,
  renderTranslation,
} from '@/src/content/renderer';
import { readUnit } from '@/src/content/scanner';

const byId = (id: string) => document.getElementById(id)!;
const trOf = (el: Element) => el.querySelector(':scope > it-tr');

describe('renderer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
  });

  it('译文插在锚点之后、嵌套块之前', () => {
    document.body.innerHTML = '<ul><li id="outer">Outer text <ul id="nested"><li>Inner</li></ul></li></ul>';
    const unit = readUnit(byId('outer'))!;
    expect(renderTranslation(unit, '外层文字', 'final')).toBe(true);
    const tr = trOf(byId('outer'))!;
    expect(tr.textContent).toBe('外层文字');
    expect(tr.nextElementSibling).toBe(byId('nested'));
  });

  it('draft 带半透明类，final 覆盖 draft 并去掉该类', () => {
    document.body.innerHTML = '<p id="p">Hello world</p>';
    const unit = readUnit(byId('p'))!;
    renderTranslation(unit, '初稿', 'draft');
    expect(trOf(byId('p'))!.classList.contains('it-draft')).toBe(true);
    expect(renderTranslation(unit, '终稿', 'final')).toBe(true);
    expect(trOf(byId('p'))!.textContent).toBe('终稿');
    expect(trOf(byId('p'))!.classList.contains('it-draft')).toBe(false);
    expect(byId('p').querySelectorAll('it-tr')).toHaveLength(1);
  });

  it('低等级结果不能覆盖高等级结果', () => {
    document.body.innerHTML = '<p id="p">Hello world</p>';
    const unit = readUnit(byId('p'))!;
    renderTranslation(unit, '终稿', 'final');
    expect(renderTranslation(unit, '初稿', 'draft')).toBe(false);
    expect(renderTranslation(unit, '另一个终稿', 'final')).toBe(false);
    expect(trOf(byId('p'))!.textContent).toBe('终稿');
  });

  it('译文节点被移除后 isRendered 为 false；clearTranslation 清理干净', () => {
    document.body.innerHTML = '<p id="p">Hello world</p>';
    renderTranslation(readUnit(byId('p'))!, '你好', 'final');
    expect(isRendered(byId('p'))).toBe(true);
    trOf(byId('p'))!.remove();
    expect(isRendered(byId('p'))).toBe(false);
    clearTranslation(byId('p'));
    expect(byId('p').hasAttribute('data-it-level')).toBe(false);
  });

  it('applyMode 切换 html 上的类', () => {
    applyMode(document, true, 'dual');
    expect(document.documentElement.className).toBe('it-on');
    applyMode(document, true, 'only');
    expect(document.documentElement.classList.contains('it-only')).toBe(true);
    applyMode(document, false, 'only');
    expect(document.documentElement.classList.contains('it-on')).toBe(false);
  });

  it('injectStyles 只注入一次', () => {
    injectStyles(document);
    injectStyles(document);
    expect(document.querySelectorAll('#it-styles')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/content/renderer.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`src/content/renderer.ts`：

```ts
import { TR_TAG } from '../shared/constants';
import type { DisplayMode } from '../shared/settings';
import type { Unit } from './scanner';

export type Level = 'draft' | 'final';

const LEVEL_ATTR = 'data-it-level';
const STYLE_ID = 'it-styles';
const RANK: Record<Level, number> = { draft: 1, final: 2 };
const L = `[${LEVEL_ATTR}]`;

/**
 * 关闭：隐藏全部译文；双语：译文显示在原文下方；
 * 只看译文：段落块 font-size:0 隐藏裸文本，隐藏非译文子元素（包含其它已翻译块的容器除外），
 * 译文用创建时记录的字号 --it-fs 恢复。
 */
const STYLES = `
${TR_TAG} { display: none; }
html.it-on ${TR_TAG} { display: block; white-space: normal; margin-top: .25em; }
html.it-on ${TR_TAG}.it-draft { opacity: .6; }
html.it-on.it-only ${L} { font-size: 0 !important; }
html.it-on.it-only ${L} > ${TR_TAG} { font-size: var(--it-fs) !important; margin-top: 0; }
html.it-on.it-only ${L} > :not(${TR_TAG}):not(${L}):not(:has(${L})) { display: none !important; }
html.it-on.it-only ${L} > :is(${L}, :has(${L})) { font-size: var(--it-fs); }
`;

export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  (doc.head ?? doc.documentElement).append(style);
}

export function applyMode(doc: Document, enabled: boolean, mode: DisplayMode): void {
  const classes = doc.documentElement.classList;
  classes.toggle('it-on', enabled);
  classes.toggle('it-only', mode === 'only');
}

function ownTr(block: Element): Element | null {
  return block.querySelector(`:scope > ${TR_TAG}`);
}

export function isRendered(block: Element): boolean {
  return block.hasAttribute(LEVEL_ATTR) && ownTr(block) !== null;
}

export function clearTranslation(block: Element): void {
  ownTr(block)?.remove();
  block.removeAttribute(LEVEL_ATTR);
}

function createTr(unit: Unit): Element {
  const { block, anchor } = unit;
  (block as HTMLElement).style?.setProperty('--it-fs', getComputedStyle(block).fontSize);
  const tr = block.ownerDocument.createElement(TR_TAG);
  if (anchor.parentNode === block) block.insertBefore(tr, anchor.nextSibling);
  else block.append(tr);
  return tr;
}

/** 渲染译文；质量等级只升不降，返回是否实际渲染 */
export function renderTranslation(unit: Unit, text: string, level: Level): boolean {
  const current = unit.block.getAttribute(LEVEL_ATTR) as Level | null;
  if (current && RANK[current] >= RANK[level]) return false;
  const tr = ownTr(unit.block) ?? createTr(unit);
  tr.textContent = text;
  tr.classList.toggle('it-draft', level === 'draft');
  unit.block.setAttribute(LEVEL_ATTR, level);
  return true;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/content/renderer.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/content/renderer.ts tests/content/renderer.test.ts
git commit -m "feat: 新增译文渲染，支持质量等级与三种显示模式"
```

---

### Task 5: 本地翻译引擎（local-engine）

**Files:**
- Create: `src/content/local-engine.ts`
- Test: `tests/content/local-engine.test.ts`

**Interfaces:**
- Consumes: `SOURCE_LANG, TARGET_LANG`
- Produces: `type LocalAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported'`、`interface TextTranslator { translate(text: string): Promise<string> }`、`localAvailability(scope?: object): Promise<LocalAvailability>`、`createLocalEngine(scope?: object): Promise<TextTranslator | null>`、`downloadLocalModel(onProgress: (ratio: number) => void, scope?: object): Promise<void>`

- [ ] **Step 1: 写失败测试**

`tests/content/local-engine.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
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
  it('回调下载进度', async () => {
    const progress: number[] = [];
    await downloadLocalModel((r) => progress.push(r), fakeScope('downloadable'));
    expect(progress).toEqual([0.5]);
  });

  it('不支持时抛错', async () => {
    await expect(downloadLocalModel(() => {}, {})).rejects.toThrow('不支持');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/content/local-engine.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`src/content/local-engine.ts`：

```ts
import { SOURCE_LANG, TARGET_LANG } from '../shared/constants';

export type LocalAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

export interface TextTranslator {
  translate(text: string): Promise<string>;
}

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: DownloadMonitor) => void;
  }): Promise<TextTranslator>;
}

const LANGS = { sourceLanguage: SOURCE_LANG, targetLanguage: TARGET_LANG };
const KNOWN_STATES = ['available', 'downloadable', 'downloading', 'unavailable'] as const;

function getApi(scope: object): TranslatorApi | undefined {
  return (scope as { Translator?: TranslatorApi }).Translator;
}

export async function localAvailability(scope: object = globalThis): Promise<LocalAvailability> {
  const api = getApi(scope);
  if (!api) return 'unsupported';
  try {
    const result = await api.availability(LANGS);
    return KNOWN_STATES.find((s) => s === result) ?? 'unavailable';
  } catch (err) {
    console.warn('[沉浸翻译] 查询本地翻译可用性失败', err);
    return 'unavailable';
  }
}

/** 仅在模型已就绪时创建（下载需要用户手势，由 popup 触发） */
export async function createLocalEngine(scope: object = globalThis): Promise<TextTranslator | null> {
  if ((await localAvailability(scope)) !== 'available') return null;
  try {
    return await getApi(scope)!.create(LANGS);
  } catch (err) {
    console.warn('[沉浸翻译] 创建本地翻译器失败', err);
    return null;
  }
}

export async function downloadLocalModel(
  onProgress: (ratio: number) => void,
  scope: object = globalThis,
): Promise<void> {
  const api = getApi(scope);
  if (!api) throw new Error('当前浏览器不支持本地翻译（需要 Chrome 138+）');
  await api.create({
    ...LANGS,
    monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress(e.loaded)),
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/content/local-engine.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/content/local-engine.ts tests/content/local-engine.test.ts
git commit -m "feat: 封装 Chrome 内置 Translator 本地翻译引擎"
```

---

### Task 6: 流式解析（stream-parser）

**Files:**
- Create: `src/background/stream-parser.ts`
- Test: `tests/background/stream-parser.test.ts`

**Interfaces:**
- Produces:
  - `createSseDecoder(onDelta: (text: string) => void): { push(chunk: string): void; end(): void }`
  - `createItemParser(onItem: (index: number, text: string) => void): { push(delta: string): void; end(): void }` —— `index` 为模型输出的编号（从 1 开始）；**一旦下一个 `[n]` 开头出现或流结束，就交付上一段**；不匹配编号的行视为上一段的续行

- [ ] **Step 1: 写失败测试**

`tests/background/stream-parser.test.ts`：

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createItemParser, createSseDecoder } from '@/src/background/stream-parser';

const sseLine = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe('createSseDecoder', () => {
  it('解析跨 chunk 的 data 行，忽略 [DONE]、非 data 行和坏 JSON', () => {
    const out: string[] = [];
    const decoder = createSseDecoder((t) => out.push(t));
    const raw = `: keep-alive\n${sseLine('你')}${sseLine('好')}data: {bad json}\n\ndata: [DONE]\n\n`;
    decoder.push(raw.slice(0, 20));
    decoder.push(raw.slice(20));
    decoder.end();
    expect(out).toEqual(['你', '好']);
  });

  it('end 时处理没有换行结尾的最后一行', () => {
    const out: string[] = [];
    const decoder = createSseDecoder((t) => out.push(t));
    decoder.push(sseLine('尾').trimEnd());
    decoder.end();
    expect(out).toEqual(['尾']);
  });
});

describe('createItemParser', () => {
  it('按编号切分，结束时交付最后一段', () => {
    const out: [number, string][] = [];
    const parser = createItemParser((i, t) => out.push([i, t]));
    parser.push('[1] 第一段\n[2] 第二');
    parser.push('段\n');
    parser.end();
    expect(out).toEqual([[1, '第一段'], [2, '第二段']]);
  });

  it('下一个编号一出现就交付上一段（不等整行结束）', () => {
    const out: [number, string][] = [];
    const parser = createItemParser((i, t) => out.push([i, t]));
    parser.push('[1] 第一段\n[2]');
    expect(out).toEqual([[1, '第一段']]);
  });

  it('续行拼接到上一段，忽略编号前的废话和空译文', () => {
    const out: [number, string][] = [];
    const parser = createItemParser((i, t) => out.push([i, t]));
    parser.push('好的，以下是翻译：\n[1] 上半句\n下半句\n[2]   \n[3] 三\n');
    parser.end();
    expect(out).toEqual([[1, '上半句下半句'], [3, '三']]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/background/stream-parser.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`src/background/stream-parser.ts`：

```ts
/** 按换行切分的增量缓冲：完整行交给 onLine，残余留在缓冲区 */
function createLineBuffer(onLine: (line: string) => void) {
  let buffer = '';
  return {
    push(chunk: string): string {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(onLine);
      return buffer;
    },
    end(): void {
      if (buffer) onLine(buffer);
      buffer = '';
    },
  };
}

function extractDelta(data: string): string {
  try {
    const json = JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : '';
  } catch (err) {
    console.warn('[沉浸翻译] 无法解析 SSE 数据', data, err);
    return '';
  }
}

/** 解析 OpenAI 兼容接口的 SSE 流，回调每个增量文本 */
export function createSseDecoder(onDelta: (text: string) => void) {
  const lines = createLineBuffer((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice('data:'.length).trim();
    if (data === '[DONE]') return;
    const delta = extractDelta(data);
    if (delta) onDelta(delta);
  });
  return { push: (chunk: string) => void lines.push(chunk), end: () => lines.end() };
}

const ITEM_LINE = /^\s*\[(\d+)\]\s*(.*)$/;
const ITEM_START = /^\s*\[\d+\]/;

/** 把模型输出切成「[编号] 译文」：下一个编号出现或流结束时交付上一段 */
export function createItemParser(onItem: (index: number, text: string) => void) {
  let current: { readonly index: number; readonly text: string } | null = null;

  const emit = () => {
    if (current && current.text.trim()) onItem(current.index, current.text.trim());
    current = null;
  };

  const lines = createLineBuffer((line) => {
    const match = ITEM_LINE.exec(line);
    if (match) {
      emit();
      current = { index: Number(match[1]), text: match[2] ?? '' };
    } else if (current && line.trim()) {
      current = { ...current, text: current.text + line.trim() };
    }
  });

  return {
    push(delta: string): void {
      const rest = lines.push(delta);
      if (ITEM_START.test(rest)) emit();
    },
    end(): void {
      lines.end();
      emit();
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/background/stream-parser.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/background/stream-parser.ts tests/background/stream-parser.test.ts
git commit -m "feat: 新增 SSE 流解码与编号译文切分"
```

---

### Task 7: 大模型客户端（llm-client）

**Files:**
- Create: `src/background/llm-client.ts`
- Test: `tests/background/llm-client.test.ts`

**Interfaces:**
- Consumes: `LlmConfig`（settings）、`createSseDecoder, createItemParser`（stream-parser）
- Produces: `type FetchFn = (input: string, init: RequestInit) => Promise<Response>`、`buildMessages(pageTitle: string, texts: readonly string[]): ChatMessage[]`、`chatEndpoint(baseURL: string): string`、`streamTranslate(config: LlmConfig, pageTitle: string, texts: readonly string[], onItem: (index: number, text: string) => void, fetchFn?: FetchFn): Promise<void>` —— `onItem` 的 `index` 为 **0 起始**下标，越界编号丢弃；非 2xx 抛 `Error`

- [ ] **Step 1: 写失败测试**

`tests/background/llm-client.test.ts`：

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildMessages, chatEndpoint, streamTranslate } from '@/src/background/llm-client';

const config = { baseURL: 'https://api.example.com/v1/', apiKey: 'sk-test', model: 'fast-model' };

function sseResponse(contents: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const content of contents) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('buildMessages', () => {
  it('每段折叠成单行并编号，system 中带页面标题', () => {
    const [system, user] = buildMessages('My Page', ['Hello\n  world', 'Second']);
    expect(system!.content).toContain('My Page');
    expect(user!.content).toBe('[1] Hello world\n[2] Second');
  });
});

describe('chatEndpoint', () => {
  it('去掉多余斜杠', () => {
    expect(chatEndpoint('https://a.com/v1///')).toBe('https://a.com/v1/chat/completions');
  });
});

describe('streamTranslate', () => {
  it('发送正确的请求并按 0 起始下标回调', async () => {
    const fetchFn = vi.fn(async () => sseResponse(['[1] 你好\n[2] 世', '界\n[9] 越界']));
    const out: [number, string][] = [];
    await streamTranslate(config, 'T', ['Hello', 'World'], (i, t) => out.push([i, t]), fetchFn);

    expect(out).toEqual([[0, '你好'], [1, '世界']]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'fast-model', stream: true, temperature: 0 });
  });

  it('非 2xx 抛出带状态码的错误', async () => {
    const fetchFn = vi.fn(async () => new Response('invalid key', { status: 401 }));
    await expect(streamTranslate(config, 'T', ['Hi'], () => {}, fetchFn)).rejects.toThrow('HTTP 401: invalid key');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/background/llm-client.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`src/background/llm-client.ts`：

```ts
import type { LlmConfig } from '../shared/settings';
import { createItemParser, createSseDecoder } from './stream-parser';

export interface ChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

const ERROR_DETAIL_MAX = 200;

export function buildMessages(pageTitle: string, texts: readonly string[]): ChatMessage[] {
  const system = [
    '你是专业的英译中翻译引擎。把用户给出的每一段英文翻译成简体中文。',
    '规则：',
    '1. 每段以 [编号] 开头；输出时保持相同编号，每段占一行，格式为：[编号] 译文',
    '2. 只输出译文，不要解释，不要遗漏或合并编号',
    '3. 代码、命令、URL、专有名词、产品名保持原样',
    '4. 译文自然流畅，符合中文表达习惯',
    `页面标题（仅供理解语境）：${pageTitle}`,
  ].join('\n');
  const user = texts.map((t, i) => `[${i + 1}] ${t.replace(/\s+/g, ' ').trim()}`).join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function chatEndpoint(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/chat/completions`;
}

/** 流式翻译一批段落，每完成一段回调 (0 起始下标, 译文) */
export async function streamTranslate(
  config: LlmConfig,
  pageTitle: string,
  texts: readonly string[],
  onItem: (index: number, text: string) => void,
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): Promise<void> {
  const res = await fetchFn(chatEndpoint(config.baseURL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      temperature: 0,
      messages: buildMessages(pageTitle, texts),
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`大模型请求失败 HTTP ${res.status}: ${detail.slice(0, ERROR_DETAIL_MAX)}`);
  }
  const items = createItemParser((n, text) => {
    if (n >= 1 && n <= texts.length) onItem(n - 1, text);
  });
  const sse = createSseDecoder((delta) => items.push(delta));
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    sse.push(chunk.value);
  }
  sse.end();
  items.end();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/background/llm-client.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/background/llm-client.ts tests/background/llm-client.test.ts
git commit -m "feat: 新增 OpenAI 兼容流式翻译客户端"
```

---

### Task 8: 攒批器与信号量（batching）

**Files:**
- Create: `src/background/batching.ts`
- Test: `tests/background/batching.test.ts`

**Interfaces:**
- Produces:
  - `interface Semaphore { run<T>(task: () => Promise<T>): Promise<T> }`、`createSemaphore(max: number): Semaphore`
  - `interface BatcherOptions<T> { maxItems; maxChars; waitMs; size: (item: T) => number; flush: (batch: readonly T[]) => void }`
  - `createBatcher<T>(options: BatcherOptions<T>): { push(item: T): void; dispose(): void }` —— 满 `maxItems` 立即发；加入会超 `maxChars` 时先发已有的；否则首个元素进来后 `waitMs` 发

- [ ] **Step 1: 写失败测试**

`tests/background/batching.test.ts`：

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatcher, createSemaphore } from '@/src/background/batching';

describe('createSemaphore', () => {
  it('同时运行的任务不超过上限', async () => {
    const semaphore = createSemaphore(2);
    let running = 0;
    let peak = 0;
    const task = () =>
      semaphore.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      });
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });

  it('任务失败也会释放名额并向上抛错', async () => {
    const semaphore = createSemaphore(1);
    await expect(semaphore.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('createBatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (flush: (b: readonly string[]) => void) =>
    createBatcher<string>({ maxItems: 3, maxChars: 10, waitMs: 100, size: (s) => s.length, flush });

  it('等待 waitMs 后发送', () => {
    const flush = vi.fn();
    const batcher = make(flush);
    batcher.push('a');
    batcher.push('b');
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledWith(['a', 'b']);
  });

  it('满 maxItems 立即发送', () => {
    const flush = vi.fn();
    const batcher = make(flush);
    ['a', 'b', 'c'].forEach((s) => batcher.push(s));
    expect(flush).toHaveBeenCalledWith(['a', 'b', 'c']);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('超出 maxChars 时先发送已有的', () => {
    const flush = vi.fn();
    const batcher = make(flush);
    batcher.push('123456');
    batcher.push('7890ab');
    expect(flush).toHaveBeenCalledWith(['123456']);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenLastCalledWith(['7890ab']);
  });

  it('dispose 后不再发送', () => {
    const flush = vi.fn();
    const batcher = make(flush);
    batcher.push('a');
    batcher.dispose();
    vi.advanceTimersByTime(100);
    expect(flush).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/background/batching.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`src/background/batching.ts`：

```ts
export interface Semaphore {
  run<T>(task: () => Promise<T>): Promise<T>;
}

/** 名额直接移交给等待者，避免释放瞬间被插队导致超额 */
export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const waiters: (() => void)[] = [];

  const acquire = async (): Promise<void> => {
    if (active < max) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  };

  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else active--;
  };

  return {
    async run(task) {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

export interface BatcherOptions<T> {
  readonly maxItems: number;
  readonly maxChars: number;
  readonly waitMs: number;
  readonly size: (item: T) => number;
  readonly flush: (batch: readonly T[]) => void;
}

export function createBatcher<T>(options: BatcherOptions<T>) {
  let pending: readonly T[] = [];
  let chars = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reset = (): void => {
    clearTimeout(timer);
    timer = undefined;
    pending = [];
    chars = 0;
  };

  const flushNow = (): void => {
    const batch = pending;
    reset();
    if (batch.length > 0) options.flush(batch);
  };

  return {
    push(item: T): void {
      const size = options.size(item);
      if (pending.length > 0 && chars + size > options.maxChars) flushNow();
      pending = [...pending, item];
      chars += size;
      if (pending.length >= options.maxItems) flushNow();
      else timer ??= setTimeout(flushNow, options.waitMs);
    },
    dispose: reset,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/background/batching.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/background/batching.ts tests/background/batching.test.ts
git commit -m "feat: 新增请求攒批器与并发信号量"
```

---

### Task 9: 译文缓存（cache）

**Files:**
- Create: `src/background/cache.ts`
- Test: `tests/background/cache.test.ts`

**Interfaces:**
- Produces: `interface TranslationCache { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void> }`、`cacheKey(model: string, text: string): Promise<string>`（SHA-256 十六进制）、`createIdbCache(store?: UseStore): TranslationCache`

- [ ] **Step 1: 写失败测试**

`tests/background/cache.test.ts`：

```ts
// @vitest-environment node
import 'fake-indexeddb/auto';
import { createStore } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { cacheKey, createIdbCache } from '@/src/background/cache';

describe('cacheKey', () => {
  it('相同输入得到相同的 64 位十六进制 key，模型不同则不同', async () => {
    const a = await cacheKey('m1', 'Hello');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await cacheKey('m1', 'Hello')).toBe(a);
    expect(await cacheKey('m2', 'Hello')).not.toBe(a);
  });
});

describe('createIdbCache', () => {
  it('写入后可读出，未写入的为 undefined', async () => {
    const cache = createIdbCache(createStore('test-db', 'test-store'));
    await cache.set('k', '你好');
    expect(await cache.get('k')).toBe('你好');
    expect(await cache.get('missing')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/background/cache.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`src/background/cache.ts`：

```ts
import { createStore, get, set, type UseStore } from 'idb-keyval';

export interface TranslationCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

const DB_NAME = 'immersive-translator';
const STORE_NAME = 'translations';

export async function cacheKey(model: string, text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${model}\n${text}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createIdbCache(store: UseStore = createStore(DB_NAME, STORE_NAME)): TranslationCache {
  return {
    get: (key) => get<string>(key, store),
    set: (key, value) => set(key, value, store),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/background/cache.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/background/cache.ts tests/background/cache.test.ts
git commit -m "feat: 新增基于 IndexedDB 的精翻缓存"
```

---

### Task 10: 消息协议 + 后台长连接处理（messages、port-handler）

**Files:**
- Create: `src/shared/messages.ts`、`src/background/port-handler.ts`
- Test: `tests/shared/messages.test.ts`、`tests/background/port-handler.test.ts`

**Interfaces:**
- Consumes: `DisplayMode, LlmConfig, isLlmConfigured`、`createBatcher, Semaphore`、`cacheKey, TranslationCache`、`BATCH_MAX_ITEMS, BATCH_MAX_CHARS, BATCH_WAIT_MS`
- Produces:
  - `messages.ts`：`TranslateItem {id; text}`、`TranslateRequest {type:'translate'; pageTitle; items}`、`TranslateResult {type:'result'; id; text}`、`TabCommand = {type:'get-state'} | {type:'toggle'} | {type:'toggle-mode'}`、`PageState {enabled; mode; hostname; localEngine}`、`isTranslateRequest(msg: unknown)`、`isTranslateResult(msg: unknown)`、`isTabCommand(msg: unknown)`
  - `port-handler.ts`：`PortLike`、`TranslateFn = (config, pageTitle, texts, onItem) => Promise<void>`（与 `streamTranslate` 前 4 个参数一致）、`PortHandlerDeps {getConfig; cache; semaphore; translate; reportError}`、`handlePort(port: PortLike, deps: PortHandlerDeps): void`

- [ ] **Step 1: 写消息协议的失败测试**

`tests/shared/messages.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { isTabCommand, isTranslateRequest, isTranslateResult } from '@/src/shared/messages';

describe('消息类型守卫', () => {
  it('isTranslateRequest', () => {
    expect(isTranslateRequest({ type: 'translate', pageTitle: 't', items: [{ id: '1', text: 'a' }] })).toBe(true);
    expect(isTranslateRequest({ type: 'translate', pageTitle: 't', items: [{ id: 1, text: 'a' }] })).toBe(false);
    expect(isTranslateRequest({ type: 'translate', items: [] })).toBe(false);
    expect(isTranslateRequest(null)).toBe(false);
  });

  it('isTranslateResult', () => {
    expect(isTranslateResult({ type: 'result', id: '1', text: '你好' })).toBe(true);
    expect(isTranslateResult({ type: 'result', id: '1' })).toBe(false);
  });

  it('isTabCommand', () => {
    expect(isTabCommand({ type: 'toggle' })).toBe(true);
    expect(isTabCommand({ type: 'get-state' })).toBe(true);
    expect(isTabCommand({ type: 'toggle-mode' })).toBe(true);
    expect(isTabCommand({ type: 'other' })).toBe(false);
    expect(isTabCommand('toggle')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败，然后实现 messages.ts**

Run: `pnpm test tests/shared/messages.test.ts` → Expected: FAIL

`src/shared/messages.ts`：

```ts
import type { DisplayMode } from './settings';

export interface TranslateItem {
  readonly id: string;
  readonly text: string;
}

/** 内容脚本 → 后台 */
export interface TranslateRequest {
  readonly type: 'translate';
  readonly pageTitle: string;
  readonly items: readonly TranslateItem[];
}

/** 后台 → 内容脚本（均为精翻终稿） */
export interface TranslateResult {
  readonly type: 'result';
  readonly id: string;
  readonly text: string;
}

/** popup / 快捷键 → 内容脚本 */
export type TabCommand = { readonly type: 'get-state' } | { readonly type: 'toggle' } | { readonly type: 'toggle-mode' };

export interface PageState {
  readonly enabled: boolean;
  readonly mode: DisplayMode;
  readonly hostname: string;
  readonly localEngine: boolean;
}

function asRecord(msg: unknown): Record<string, unknown> | null {
  return msg && typeof msg === 'object' ? (msg as Record<string, unknown>) : null;
}

function isItem(item: unknown): item is TranslateItem {
  const r = asRecord(item);
  return Boolean(r && typeof r.id === 'string' && typeof r.text === 'string');
}

export function isTranslateRequest(msg: unknown): msg is TranslateRequest {
  const r = asRecord(msg);
  return Boolean(
    r && r.type === 'translate' && typeof r.pageTitle === 'string' && Array.isArray(r.items) && r.items.every(isItem),
  );
}

export function isTranslateResult(msg: unknown): msg is TranslateResult {
  const r = asRecord(msg);
  return Boolean(r && r.type === 'result' && typeof r.id === 'string' && typeof r.text === 'string');
}

const TAB_COMMANDS = new Set(['get-state', 'toggle', 'toggle-mode']);

export function isTabCommand(msg: unknown): msg is TabCommand {
  const r = asRecord(msg);
  return Boolean(r && typeof r.type === 'string' && TAB_COMMANDS.has(r.type));
}
```

Run: `pnpm test tests/shared/messages.test.ts` → Expected: PASS

- [ ] **Step 3: 写 port-handler 的失败测试**

`tests/background/port-handler.test.ts`：

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSemaphore } from '@/src/background/batching';
import { cacheKey, type TranslationCache } from '@/src/background/cache';
import { handlePort, type PortHandlerDeps, type PortLike, type TranslateFn } from '@/src/background/port-handler';
import type { TranslateResult } from '@/src/shared/messages';

const CONFIG = { baseURL: 'https://a.com/v1', apiKey: 'k', model: 'm' };

function fakePort() {
  const listeners: { message?: (m: unknown) => void; disconnect?: () => void } = {};
  const posted: TranslateResult[] = [];
  const port: PortLike = {
    postMessage: (m) => posted.push(m),
    onMessage: { addListener: (fn) => (listeners.message = fn) },
    onDisconnect: { addListener: (fn) => (listeners.disconnect = fn) },
  };
  return {
    port,
    posted,
    send: (m: unknown) => listeners.message!(m),
    disconnect: () => listeners.disconnect!(),
  };
}

function memoryCache(initial: Record<string, string> = {}): TranslationCache & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, get: async (k) => data[k], set: async (k, v) => void (data[k] = v) };
}

const echoTranslate: TranslateFn = async (_c, _t, texts, onItem) => texts.forEach((t, i) => onItem(i, `译:${t}`));

function setup(overrides: Partial<PortHandlerDeps> = {}) {
  const p = fakePort();
  const deps: PortHandlerDeps = {
    getConfig: async () => CONFIG,
    cache: memoryCache(),
    semaphore: createSemaphore(3),
    translate: vi.fn(echoTranslate),
    reportError: vi.fn(),
    ...overrides,
  };
  handlePort(p.port, deps);
  return { ...p, deps };
}

const request = (items: [string, string][]) => ({
  type: 'translate',
  pageTitle: 'Page',
  items: items.map(([id, text]) => ({ id, text })),
});

describe('handlePort', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('缓存命中直接回推，不调用大模型', async () => {
    const cache = memoryCache({ [await cacheKey('m', 'Hello')]: '你好' });
    const { send, posted, deps } = setup({ cache });
    send(request([['1', 'Hello']]));
    await vi.runAllTimersAsync();
    expect(posted).toEqual([{ type: 'result', id: '1', text: '你好' }]);
    expect(deps.translate).not.toHaveBeenCalled();
  });

  it('未命中时攒批请求大模型，回推结果并写缓存', async () => {
    const cache = memoryCache();
    const { send, posted, deps } = setup({ cache });
    send(request([['1', 'Hello'], ['2', 'World']]));
    await vi.runAllTimersAsync();
    expect(deps.translate).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([
      { type: 'result', id: '1', text: '译:Hello' },
      { type: 'result', id: '2', text: '译:World' },
    ]);
    expect(cache.data[await cacheKey('m', 'World')]).toBe('译:World');
  });

  it('相同原文只请求一次，所有等待的段落都收到结果', async () => {
    const { send, posted, deps } = setup();
    send(request([['1', 'Same'], ['2', 'Same']]));
    await vi.runAllTimersAsync();
    expect(vi.mocked(deps.translate).mock.calls[0]![2]).toEqual(['Same']);
    expect(posted.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('大模型失败时上报错误', async () => {
    const { send, posted, deps } = setup({ translate: vi.fn(async () => Promise.reject(new Error('HTTP 401'))) });
    send(request([['1', 'Hello']]));
    await vi.runAllTimersAsync();
    expect(deps.reportError).toHaveBeenCalledWith('HTTP 401');
    expect(posted).toEqual([]);
  });

  it('未配置大模型或消息非法时忽略', async () => {
    const { send, posted, deps } = setup({ getConfig: async () => ({ ...CONFIG, apiKey: '' }) });
    send(request([['1', 'Hello']]));
    send({ type: 'nonsense' });
    await vi.runAllTimersAsync();
    expect(deps.translate).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it('断开连接后不再回推', async () => {
    const { send, posted, disconnect } = setup();
    send(request([['1', 'Hello']]));
    disconnect();
    await vi.runAllTimersAsync();
    expect(posted).toEqual([]);
  });
});
```

- [ ] **Step 4: 运行确认失败**

Run: `pnpm test tests/background/port-handler.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 5: 实现 port-handler.ts**

`src/background/port-handler.ts`：

```ts
import { BATCH_MAX_CHARS, BATCH_MAX_ITEMS, BATCH_WAIT_MS } from '../shared/constants';
import { isTranslateRequest, type TranslateResult } from '../shared/messages';
import { isLlmConfigured, type LlmConfig } from '../shared/settings';
import { createBatcher, type Semaphore } from './batching';
import { cacheKey, type TranslationCache } from './cache';

export interface PortLike {
  postMessage(message: TranslateResult): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export type TranslateFn = (
  config: LlmConfig,
  pageTitle: string,
  texts: readonly string[],
  onItem: (index: number, text: string) => void,
) => Promise<void>;

export interface PortHandlerDeps {
  readonly getConfig: () => Promise<LlmConfig>;
  readonly cache: TranslationCache;
  readonly semaphore: Semaphore;
  readonly translate: TranslateFn;
  readonly reportError: (message: string) => void;
}

interface Job {
  readonly text: string;
  readonly key: string;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 处理一个标签页的长连接：查缓存 → 攒批 → 流式精翻 → 回推并写缓存 */
export function handlePort(port: PortLike, deps: PortHandlerDeps): void {
  let connected = true;
  let pageTitle = '';
  let config: LlmConfig | null = null;
  const waiting = new Map<string, readonly string[]>(); // 原文 → 等待它的段落 id

  const post = (id: string, text: string) => {
    if (connected) port.postMessage({ type: 'result', id, text });
  };

  const deliver = (job: Job, text: string) => {
    (waiting.get(job.text) ?? []).forEach((id) => post(id, text));
    waiting.delete(job.text);
    deps.cache.set(job.key, text).catch((err) => console.warn('[沉浸翻译] 写缓存失败', err));
  };

  const onItem = (batch: readonly Job[]) => (index: number, text: string) => {
    const job = batch[index];
    if (job) deliver(job, text);
  };

  const runBatch = (batch: readonly Job[], cfg: LlmConfig) =>
    deps.semaphore
      .run(() => deps.translate(cfg, pageTitle, batch.map((j) => j.text), onItem(batch)))
      .catch((err: unknown) => deps.reportError(errorMessage(err)))
      .finally(() => batch.forEach((job) => waiting.delete(job.text)));

  const batcher = createBatcher<Job>({
    maxItems: BATCH_MAX_ITEMS,
    maxChars: BATCH_MAX_CHARS,
    waitMs: BATCH_WAIT_MS,
    size: (job) => job.text.length,
    flush: (batch) => {
      if (config) void runBatch(batch, config);
    },
  });

  const enqueue = async (cfg: LlmConfig, id: string, text: string) => {
    const key = await cacheKey(cfg.model, text);
    const cached = await deps.cache.get(key).catch((err: unknown) => {
      console.warn('[沉浸翻译] 读缓存失败', err);
      return undefined;
    });
    if (!connected) return;
    if (cached) return post(id, cached);
    const queued = waiting.get(text);
    waiting.set(text, [...(queued ?? []), id]);
    if (!queued) batcher.push({ text, key });
  };

  port.onMessage.addListener((message) => {
    if (!isTranslateRequest(message)) return;
    void (async () => {
      const cfg = await deps.getConfig();
      if (!isLlmConfigured(cfg)) return;
      config = cfg;
      pageTitle = message.pageTitle;
      for (const item of message.items) await enqueue(cfg, item.id, item.text);
    })().catch((err: unknown) => deps.reportError(errorMessage(err)));
  });

  port.onDisconnect.addListener(() => {
    connected = false;
    batcher.dispose();
    waiting.clear();
  });
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm test tests/shared/messages.test.ts tests/background/port-handler.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/shared/messages.ts src/background/port-handler.ts tests/shared/messages.test.ts tests/background/port-handler.test.ts
git commit -m "feat: 新增消息协议与后台长连接处理（缓存/去重/攒批）"
```

---

### Task 11: 内容脚本编排（controller）

**Files:**
- Create: `src/content/controller.ts`
- Test: `tests/content/controller.test.ts`

**Interfaces:**
- Consumes: `findBlocks, readUnit, Unit`（scanner）、`shouldTranslate`（text-filter）、`renderTranslation, isRendered, clearTranslation, applyMode, injectStyles, Level`（renderer）、`TextTranslator`（local-engine）、`TranslateItem, TranslateRequest`（messages）、`DisplayMode`、`CONTENT_FLUSH_MS, MUTATION_DEBOUNCE_MS, TR_TAG`
- Produces:
  - `interface VisibilityObserver { observe(el: Element): void; disconnect(): void }`
  - `type CreateVisibilityObserver = (onVisible: (els: readonly Element[]) => void) => VisibilityObserver` —— 实现方负责「元素进入视口后回调一次并停止观察」
  - `interface ControllerDeps { doc; local: TextTranslator | null; llmEnabled: boolean; mode: DisplayMode; sendToLlm(req: TranslateRequest): void; createVisibilityObserver }`
  - `class Controller { state: {enabled; mode}; enable(); disable(); toggle(); setMode(mode); handleResult(id: string, text: string) }`

- [ ] **Step 1: 写失败测试**

`tests/content/controller.test.ts`：

```ts
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
  afterEach(() => vi.useRealTimers());

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
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/content/controller.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`src/content/controller.ts`：

```ts
import { CONTENT_FLUSH_MS, MUTATION_DEBOUNCE_MS, TR_TAG } from '../shared/constants';
import type { TranslateItem, TranslateRequest } from '../shared/messages';
import type { DisplayMode } from '../shared/settings';
import type { TextTranslator } from './local-engine';
import { applyMode, clearTranslation, injectStyles, isRendered, renderTranslation, type Level } from './renderer';
import { findBlocks, readUnit, type Unit } from './scanner';
import { shouldTranslate } from './text-filter';

export interface VisibilityObserver {
  observe(el: Element): void;
  disconnect(): void;
}

/** 实现方负责：元素进入视口后回调一次并停止观察该元素 */
export type CreateVisibilityObserver = (onVisible: (els: readonly Element[]) => void) => VisibilityObserver;

export interface ControllerDeps {
  readonly doc: Document;
  readonly local: TextTranslator | null;
  readonly llmEnabled: boolean;
  readonly mode: DisplayMode;
  readonly sendToLlm: (request: TranslateRequest) => void;
  readonly createVisibilityObserver: CreateVisibilityObserver;
}

const isTr = (node: Node) => node.nodeName.toLowerCase() === TR_TAG;

export class Controller {
  private enabled = false;
  private mode: DisplayMode;
  private nextId = 0;
  private readonly units = new Map<string, Unit>();
  private readonly sources = new WeakMap<Element, string>();
  private readonly inFlight = new WeakSet<Element>();
  private readonly pending = new Set<Element>();
  private readonly mutationRoots = new Set<Element>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private mutationTimer: ReturnType<typeof setTimeout> | undefined;
  private visibility: VisibilityObserver | null = null;
  private mutations: MutationObserver | null = null;

  constructor(private readonly deps: ControllerDeps) {
    this.mode = deps.mode;
  }

  get state(): { readonly enabled: boolean; readonly mode: DisplayMode } {
    return { enabled: this.enabled, mode: this.mode };
  }

  enable(): void {
    if (this.enabled) return;
    const { doc } = this.deps;
    this.enabled = true;
    injectStyles(doc);
    applyMode(doc, true, this.mode);
    this.visibility = this.deps.createVisibilityObserver((els) => this.onVisible(els));
    this.mutations = new MutationObserver((records) => this.onMutations(records));
    this.mutations.observe(doc.body, { childList: true, subtree: true, characterData: true });
    this.scan(doc.body);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    applyMode(this.deps.doc, false, this.mode);
    this.visibility?.disconnect();
    this.mutations?.disconnect();
    this.visibility = null;
    this.mutations = null;
    clearTimeout(this.flushTimer);
    clearTimeout(this.mutationTimer);
    this.flushTimer = undefined;
    this.mutationTimer = undefined;
    this.pending.clear();
    this.mutationRoots.clear();
  }

  toggle(): void {
    if (this.enabled) this.disable();
    else this.enable();
  }

  setMode(mode: DisplayMode): void {
    this.mode = mode;
    applyMode(this.deps.doc, this.enabled, mode);
  }

  handleResult(id: string, text: string): void {
    this.render(id, text, 'final');
  }

  private scan(root: Element): void {
    findBlocks(root).forEach((block) => this.visibility?.observe(block));
  }

  private onVisible(els: readonly Element[]): void {
    els.forEach((el) => this.pending.add(el));
    this.flushTimer ??= setTimeout(() => this.flush(), CONTENT_FLUSH_MS);
  }

  private flush(): void {
    this.flushTimer = undefined;
    const blocks = [...this.pending];
    this.pending.clear();
    const items = blocks.flatMap((block) => this.prepare(block) ?? []);
    if (items.length === 0) return;
    if (this.deps.llmEnabled) {
      this.deps.sendToLlm({ type: 'translate', pageTitle: this.deps.doc.title, items });
    }
    this.translateLocally(items);
  }

  /** 原文未变且已渲染或正在翻译时跳过；否则清掉旧译文并登记新任务 */
  private prepare(block: Element): TranslateItem | null {
    const unit = readUnit(block);
    if (!unit || !shouldTranslate(unit.text)) return null;
    const unchanged = this.sources.get(block) === unit.text;
    if (unchanged && (isRendered(block) || this.inFlight.has(block))) return null;
    clearTranslation(block);
    this.sources.set(block, unit.text);
    this.inFlight.add(block);
    const id = String(this.nextId++);
    this.units.set(id, unit);
    return { id, text: unit.text };
  }

  private translateLocally(items: readonly TranslateItem[]): void {
    const { local, llmEnabled } = this.deps;
    if (!local) return;
    const level: Level = llmEnabled ? 'draft' : 'final';
    for (const item of items) {
      local.translate(item.text).then(
        (text) => this.render(item.id, text, level),
        (err: unknown) => console.warn('[沉浸翻译] 本地翻译失败', err),
      );
    }
  }

  private render(id: string, text: string, level: Level): void {
    const unit = this.units.get(id);
    if (!unit || this.sources.get(unit.block) !== unit.text) return;
    renderTranslation(unit, text, level);
    if (level === 'final') {
      this.units.delete(id);
      this.inFlight.delete(unit.block);
    }
  }

  private onMutations(records: readonly MutationRecord[]): void {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || target.closest(TR_TAG)) continue;
      if (record.type === 'characterData') this.mutationRoots.add(target);
      record.addedNodes.forEach((node) => {
        const root = node instanceof Element ? node : node.parentElement;
        if (root && !isTr(node)) this.mutationRoots.add(root);
      });
      if ([...record.removedNodes].some(isTr)) this.mutationRoots.add(target);
    }
    if (this.mutationRoots.size > 0) {
      this.mutationTimer ??= setTimeout(() => this.flushMutations(), MUTATION_DEBOUNCE_MS);
    }
  }

  private flushMutations(): void {
    this.mutationTimer = undefined;
    const roots = [...this.mutationRoots];
    this.mutationRoots.clear();
    roots.filter((root) => root.isConnected).forEach((root) => this.scan(root));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/content/controller.test.ts`
Expected: PASS（若 happy-dom 的 MutationObserver 回调时机导致动态用例失败，在 `advanceTimersByTimeAsync` 前加一次 `await Promise.resolve()` 让回调先执行）

- [ ] **Step 5: 提交**

```bash
git add src/content/controller.ts tests/content/controller.test.ts
git commit -m "feat: 新增内容脚本编排，串联视口优先、双引擎与动态内容"
```

---

### Task 12: 入口装配（后台、内容脚本、长连接通道）

**Files:**
- Create: `src/content/llm-channel.ts`、`entrypoints/content.ts`
- Modify: `entrypoints/background.ts`（替换占位）

**Interfaces:**
- Consumes: 前面所有模块
- Produces: `createLlmChannel(onResult: (r: TranslateResult) => void): { send(req: TranslateRequest): void }`

- [ ] **Step 1: 长连接通道**

`src/content/llm-channel.ts`：

```ts
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
```

- [ ] **Step 2: 后台入口**

`entrypoints/background.ts`：

```ts
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
```

- [ ] **Step 3: 内容脚本入口**

`entrypoints/content.ts`：

```ts
import { browser } from 'wxt/browser';
import { Controller, type CreateVisibilityObserver } from '@/src/content/controller';
import { createLlmChannel } from '@/src/content/llm-channel';
import { createLocalEngine } from '@/src/content/local-engine';
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
    const local = await createLocalEngine();
    const channel = createLlmChannel((result) => controller.handleResult(result.id, result.text));
    const controller = new Controller({
      doc: document,
      local,
      llmEnabled: isLlmConfigured(settings.llm),
      mode: settings.mode,
      sendToLlm: (request) => channel.send(request),
      createVisibilityObserver: createVisibility,
    });

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isTabCommand(message)) return;
      if (message.type === 'toggle') controller.toggle();
      if (message.type === 'toggle-mode') {
        const mode = controller.state.mode === 'dual' ? 'only' : 'dual';
        controller.setMode(mode);
        void saveSettings({ mode });
      }
      const state: PageState = { ...controller.state, hostname: location.hostname, localEngine: local !== null };
      sendResponse(state);
    });

    // 其它标签页切换模式后同步
    browser.storage.onChanged.addListener((changes, area) => {
      const change = changes[SETTINGS_KEY];
      if (area === 'local' && change) controller.setMode(normalizeSettings(change.newValue).mode);
    });

    const sample = (document.body?.textContent ?? '').slice(0, PAGE_SAMPLE_CHARS);
    if (shouldAutoTranslate(settings, location.hostname) && isEnglishPage(document.documentElement.lang, sample)) {
      controller.enable();
    }
  },
});
```

- [ ] **Step 4: 类型检查 + 全部单测 + 构建**

Run: `pnpm compile && pnpm test && pnpm build`
Expected: 无类型错误；全部测试 PASS；`.output/chrome-mv3/manifest.json` 含 `background.service_worker`、`content_scripts`（`<all_urls>`）、`commands`。

- [ ] **Step 5: 提交**

```bash
git add src/content/llm-channel.ts entrypoints/background.ts entrypoints/content.ts
git commit -m "feat: 装配后台与内容脚本入口，接通快捷键与长连接"
```

---

### Task 13: 弹窗与设置页（popup、options）

**Files:**
- Create: `entrypoints/popup/index.html`、`entrypoints/popup/main.ts`、`entrypoints/popup/style.css`
- Create: `entrypoints/options/index.html`、`entrypoints/options/main.ts`

**Interfaces:**
- Consumes: `TabCommand, PageState`、`loadSettings, saveSettings, toggleNeverSite, isLlmConfigured, isValidBaseURL, LlmConfig`、`localAvailability, downloadLocalModel, LocalAvailability`、`streamTranslate`、`LAST_ERROR_KEY`

- [ ] **Step 1: 弹窗 HTML 与样式**

`entrypoints/popup/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>沉浸翻译</title>
    <meta name="manifest.type" content="browser_action" />
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main>
      <p id="host" class="muted"></p>
      <p id="unsupported" class="warn" hidden>此页面无法翻译（浏览器内部页面，或页面还没加载完）</p>
      <section id="controls">
        <button id="toggle" type="button"></button>
        <button id="mode" type="button"></button>
        <label><input id="never" type="checkbox" /> 本站不自动翻译</label>
      </section>
      <h2>本地翻译</h2>
      <p id="local-status"></p>
      <button id="download" type="button" hidden>下载本地翻译模型</button>
      <h2>大模型精翻</h2>
      <p id="llm-status"></p>
      <p id="error" class="warn" hidden></p>
      <footer><a id="options" href="#">设置</a> · Alt+A 开关 · Alt+S 切换模式</footer>
    </main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`entrypoints/popup/style.css`：

```css
body { width: 280px; margin: 0; font: 13px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; color: #222; }
main { padding: 12px; }
p { margin: 0; }
h2 { margin: 12px 0 4px; font-size: 12px; font-weight: 500; color: #888; }
#controls { display: grid; gap: 6px; }
button { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; }
button:hover { background: #f4f4f4; }
.muted { margin-bottom: 8px; color: #888; }
.warn { color: #c0392b; }
footer { margin-top: 12px; font-size: 12px; color: #888; }
```

- [ ] **Step 2: 弹窗逻辑**

`entrypoints/popup/main.ts`：

```ts
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
```

- [ ] **Step 3: 设置页**

`entrypoints/options/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>沉浸翻译 - 设置</title>
    <meta name="manifest.open_in_tab" content="true" />
    <style>
      body { max-width: 560px; margin: 40px auto; padding: 0 16px; font: 14px/1.6 -apple-system, BlinkMacSystemFont, sans-serif; color: #222; }
      label { display: block; margin: 14px 0 4px; font-weight: 500; }
      input[type='text'], input[type='password'] { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 6px; }
      .hint { margin: 2px 0 0; font-size: 12px; color: #888; }
      .row { margin-top: 20px; display: flex; gap: 8px; }
      button { padding: 8px 16px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; }
      button[type='submit'] { background: #222; color: #fff; border-color: #222; }
      #status { margin-top: 16px; white-space: pre-wrap; }
      .ok { color: #1e7e34; }
      .warn { color: #c0392b; }
    </style>
  </head>
  <body>
    <h1>沉浸翻译 - 设置</h1>
    <form id="form">
      <h2>大模型精翻（OpenAI 兼容接口，三项全部留空则只用本地翻译）</h2>
      <label for="baseURL">接口地址</label>
      <input id="baseURL" type="text" placeholder="https://api.deepseek.com/v1" />
      <p class="hint">填到 /v1 为止，插件会自动拼上 /chat/completions</p>
      <label for="apiKey">API Key</label>
      <input id="apiKey" type="password" autocomplete="off" />
      <label for="model">模型</label>
      <input id="model" type="text" placeholder="deepseek-chat" />
      <p class="hint">优先选速度快的小模型，精翻体验更好</p>
      <h2>通用</h2>
      <label><input id="autoTranslate" type="checkbox" /> 打开英文网页时自动翻译</label>
      <div class="row">
        <button type="submit">保存</button>
        <button id="test" type="button">测试连接</button>
      </div>
    </form>
    <p id="status"></p>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`entrypoints/options/main.ts`：

```ts
import { streamTranslate } from '@/src/background/llm-client';
import { isLlmConfigured, isValidBaseURL, loadSettings, saveSettings, type LlmConfig } from '@/src/shared/settings';

const input = (id: string) => document.getElementById(id) as HTMLInputElement;

function showStatus(text: string, ok = true): void {
  const el = document.getElementById('status')!;
  el.textContent = text;
  el.className = ok ? 'ok' : 'warn';
}

function readForm(): LlmConfig {
  return { baseURL: input('baseURL').value.trim(), apiKey: input('apiKey').value.trim(), model: input('model').value.trim() };
}

/** 三项要么全空（不用大模型），要么全填且地址合法 */
function validate(llm: LlmConfig): string | null {
  const filled = [llm.baseURL, llm.apiKey, llm.model].filter(Boolean).length;
  if (filled === 0) return null;
  if (filled < 3) return '接口地址、API Key、模型需要全部填写（或全部留空）';
  if (!isValidBaseURL(llm.baseURL)) return '接口地址必须是 http:// 或 https:// 开头的网址';
  return null;
}

async function testConnection(): Promise<void> {
  const llm = readForm();
  const error = validate(llm) ?? (isLlmConfigured(llm) ? null : '请先填写大模型配置');
  if (error) return showStatus(error, false);
  showStatus('测试中…');
  const started = performance.now();
  try {
    let result = '';
    await streamTranslate(llm, '连接测试', ['Hello, world! This is a translation test.'], (_i, text) => {
      result = text;
    });
    const ms = Math.round(performance.now() - started);
    if (result) showStatus(`✅ ${result}（耗时 ${ms}ms）`);
    else showStatus('⚠️ 请求成功，但没有解析到译文：模型可能没有按「[编号] 译文」格式输出', false);
  } catch (err) {
    showStatus(`❌ ${err instanceof Error ? err.message : String(err)}`, false);
  }
}

async function main(): Promise<void> {
  const settings = await loadSettings();
  input('baseURL').value = settings.llm.baseURL;
  input('apiKey').value = settings.llm.apiKey;
  input('model').value = settings.llm.model;
  input('autoTranslate').checked = settings.autoTranslate;

  document.getElementById('form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const llm = readForm();
    const error = validate(llm);
    if (error) return showStatus(error, false);
    await saveSettings({ llm, autoTranslate: input('autoTranslate').checked });
    showStatus('已保存，刷新网页后生效');
  });
  document.getElementById('test')!.addEventListener('click', () => void testConnection());
}

void main();
```

- [ ] **Step 4: 类型检查 + 构建**

Run: `pnpm compile && pnpm build`
Expected: 无错误；`.output/chrome-mv3/` 下有 `popup.html`、`options.html`，manifest 中有 `action.default_popup` 与 `options_ui`。

- [ ] **Step 5: 提交**

```bash
git add entrypoints/popup entrypoints/options
git commit -m "feat: 新增弹窗（开关/模式/本地模型下载/错误提示）与设置页"
```

---

### Task 14: 端到端测试（Playwright + 模拟大模型）

**Files:**
- Create: `playwright.config.ts`、`e2e/mock-server.ts`、`e2e/extension.spec.ts`

说明：Playwright 自带的 Chromium 没有 Translator 模型，因此 E2E 覆盖「仅大模型」路径；本地引擎路径在 Task 15 用正版 Chrome 手工验证。

- [ ] **Step 1: 安装浏览器**

Run: `pnpm exec playwright install chromium`

- [ ] **Step 2: 配置与模拟服务**

`playwright.config.ts`：

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
});
```

`e2e/mock-server.ts`：

```ts
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockServer {
  readonly url: string;
  readonly llmRequests: () => number;
  readonly close: () => Promise<void>;
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Test Page</title></head><body>
<p id="p1">The quick brown fox jumps over the lazy dog.</p>
<p id="p2">Hello <a href="#">world</a>, this is a <b>test</b>.</p>
<pre id="code">const x = 1;</pre>
</body></html>`;

/** 把 user 消息里的「[n] 原文」变成「[n] 译:原文」 */
function fakeTranslate(body: string): string {
  const { messages } = JSON.parse(body) as { messages: { role: string; content: string }[] };
  const user = messages.find((m) => m.role === 'user')?.content ?? '';
  return user.replace(/^\[(\d+)\]\s*/gm, '[$1] 译:');
}

/** 每行一个 SSE 事件，模拟流式输出 */
function toSse(text: string): string {
  const events = text.split(/(?<=\n)/).map((part) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
  return `${events.join('')}data: [DONE]\n\n`;
}

export async function startMockServer(): Promise<MockServer> {
  let count = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        count++;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(toSse(fakeTranslate(body)));
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    llmRequests: () => count,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 3: 写 E2E 用例**

`e2e/extension.spec.ts`：

```ts
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

test('动态插入的段落也会被翻译', async ({ context, sw, server }) => {
  await configure(sw, server);
  const page = await context.newPage();
  await page.goto(server.url);
  await expect(page.locator('#p1 > it-tr')).toHaveText(P1);
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'p3';
    p.textContent = 'Dynamically added paragraph.';
    document.body.append(p);
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
```

- [ ] **Step 4: 运行 E2E**

Run: `pnpm test:e2e`
Expected: 5 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add playwright.config.ts e2e
git commit -m "test: 新增 Playwright 端到端测试与模拟大模型服务"
```

---

### Task 15: 覆盖率、正版 Chrome 验证与使用说明

**Files:**
- Create: `README.md`

- [ ] **Step 1: 覆盖率**

Run: `pnpm test:coverage`
Expected: `src/` 下 lines/functions/statements ≥ 80%，branches ≥ 75%。不达标时为未覆盖分支补单测（不改阈值）。

- [ ] **Step 2: 正版 Chrome 验证本地引擎（设计文档 4.3 的风险项）**

先尝试自动化：用 Playwright `channel: 'chrome'` 并加 `--disable-features=DisableLoadExtensionCommandLineSwitch` 加载 `.output/chrome-mv3`，打开 `https://en.wikipedia.org/wiki/Translation`，检查是否出现带 `it-draft` 类的 `it-tr`（需本机已下载英译中模型）。
如果正版 Chrome 拒绝命令行加载插件，就改为手工验证清单：
1. `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选择 `.output/chrome-mv3`
2. 点插件图标，本地翻译若显示「模型未下载」，点「下载本地翻译模型」
3. 打开任一英文页面，确认几乎立刻出现半透明译文
4. 若本地译文始终不出现：在页面控制台执行 `'Translator' in self` 验证内容脚本环境；不可用则按设计文档 4.3 的退路（offscreen document）另开任务

- [ ] **Step 3: 写 README**

`README.md`：

```markdown
# 沉浸翻译（自用）

英文网页双语对照翻译：Chrome 内置本地翻译秒出初稿，大模型后台流式精翻并替换。

## 安装

1. `pnpm install && pnpm build`
2. 打开 `chrome://extensions`，开启「开发者模式」，点「加载已解压的扩展程序」，选择 `.output/chrome-mv3`
3. 点插件图标 → 「下载本地翻译模型」（只需一次）
4. （可选）插件图标 → 设置：填写 OpenAI 兼容接口的地址、API Key、模型，点「测试连接」

## 使用

| 操作 | 快捷键 |
| --- | --- |
| 开关当前页翻译 | Alt+A（macOS 为 Option+A） |
| 双语对照 ⇄ 只看译文 | Alt+S（macOS 为 Option+S） |

快捷键可在 `chrome://extensions/shortcuts` 修改。半透明的是本地初稿，变成正常颜色说明大模型精翻已完成。

## 开发

- `pnpm dev`：开发模式（自动打开带插件的浏览器，热更新）
- `pnpm test` / `pnpm test:coverage`：单元与集成测试
- `pnpm test:e2e`：端到端测试（模拟大模型）

## 已知限制

- 仅英译中；仅正版 Chrome 138+
- 译文中不保留段内链接/加粗（双语模式可点原文链接）
- 精翻缓存不自动清理
```

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: 新增使用说明"
```
