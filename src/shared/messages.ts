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
