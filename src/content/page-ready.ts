import { NEXT_SCRIPT_SCAN_LIMIT, PAGE_IDLE_TIMEOUT_MS, PAGE_LOAD_MAX_WAIT_MS } from '../shared/constants';

const NO_TRANSLATE = '[translate="no"], .notranslate';

function hasNextInlineScript(doc: Document): boolean {
  return [...doc.scripts]
    .slice(0, NEXT_SCRIPT_SCAN_LIMIT)
    .some((script) => !script.src && script.textContent?.includes('__next_f'));
}

/**
 * 「脆弱」页面：服务端渲染 + React 接管（hydration）的网站。在 React 接管前改动 DOM 会导致
 * 内容不一致报错（React #418）并整页重渲染。特征：<html>/<body> 上的不翻译标记（这类网站用它
 * 防止浏览器整页翻译），或 Next.js 的根节点/数据脚本。
 */
export function isFragilePage(doc: Document): boolean {
  if (doc.documentElement.matches(NO_TRANSLATE) || doc.body?.matches(NO_TRANSLATE)) return true;
  if (doc.getElementById('__next') || doc.getElementById('__NEXT_DATA__')) return true;
  return hasNextInlineScript(doc);
}

/** 等页面 load 完成（最多 maxWaitMs）后再等浏览器空闲，此时 React 一般已完成接管 */
export async function whenPageSettled(win: Window, maxWaitMs = PAGE_LOAD_MAX_WAIT_MS): Promise<void> {
  if (win.document.readyState !== 'complete') {
    await new Promise<void>((resolve) => {
      const timer = win.setTimeout(resolve, maxWaitMs);
      win.addEventListener('load', () => {
        win.clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
  await new Promise<void>((resolve) => win.requestIdleCallback(() => resolve(), { timeout: PAGE_IDLE_TIMEOUT_MS }));
}
