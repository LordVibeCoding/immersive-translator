import type { TabCommand } from '../shared/messages';
import { toggleNeverSite, type Settings } from '../shared/settings';

export const MENU_IDS = {
  root: 'it-root',
  toggle: 'it-toggle',
  mode: 'it-mode',
  never: 'it-never-site',
  ball: 'it-ball-site',
} as const;

/** 菜单出现在：页面空白处、选中文字、链接、图片、iframe 上右键 */
type MenuContext = 'page' | 'selection' | 'link' | 'image' | 'frame';
const CONTEXTS: [MenuContext, ...MenuContext[]] = ['page', 'selection', 'link', 'image', 'frame'];

type MenuProps = { id: string; title: string; parentId?: string; contexts: [MenuContext, ...MenuContext[]] };

const MENU_ITEMS: readonly MenuProps[] = [
  { id: MENU_IDS.root, title: '沉浸翻译', contexts: CONTEXTS },
  { id: MENU_IDS.toggle, parentId: MENU_IDS.root, title: '开启 / 关闭翻译（Alt+A）', contexts: CONTEXTS },
  { id: MENU_IDS.mode, parentId: MENU_IDS.root, title: '切换 双语 / 只看译文（Alt+S）', contexts: CONTEXTS },
  { id: MENU_IDS.never, parentId: MENU_IDS.root, title: '本站不自动翻译（开 / 关）', contexts: CONTEXTS },
  { id: MENU_IDS.ball, parentId: MENU_IDS.root, title: '本站显示 / 隐藏悬浮球', contexts: CONTEXTS },
];

export interface MenuApi {
  removeAll(): Promise<void>;
  create(props: MenuProps): void;
}

/** 安装或更新时重建菜单（先清空，避免重复 id 报错） */
export async function createMenus(api: MenuApi): Promise<void> {
  await api.removeAll();
  MENU_ITEMS.forEach((item) => api.create(item));
}

export interface MenuDeps {
  sendToTab(tabId: number, command: TabCommand): Promise<void>;
  loadSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
}

const COMMANDS: Record<string, TabCommand> = {
  [MENU_IDS.toggle]: { type: 'toggle' },
  [MENU_IDS.mode]: { type: 'toggle-mode' },
};

function hostnameOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname || null : null;
  } catch {
    return null; // 非法网址（如内部页面）没有 hostname，不处理
  }
}

/** 处理右键菜单点击：开关/模式发给被点击的标签页，站点名单直接改设置（内容脚本监听设置变化） */
export async function handleMenuClick(
  menuId: string,
  tab: { id?: number; url?: string } | undefined,
  deps: MenuDeps,
): Promise<void> {
  const command = COMMANDS[menuId];
  if (command) {
    if (tab?.id !== undefined) await deps.sendToTab(tab.id, command);
    return;
  }
  if (menuId !== MENU_IDS.never && menuId !== MENU_IDS.ball) return;
  const hostname = hostnameOf(tab?.url);
  if (!hostname) return;
  const settings = await deps.loadSettings();
  if (menuId === MENU_IDS.never) {
    await deps.saveSettings({ neverSites: toggleNeverSite(settings.neverSites, hostname) });
  } else {
    await deps.saveSettings({ ballHiddenSites: toggleNeverSite(settings.ballHiddenSites, hostname) });
  }
}
