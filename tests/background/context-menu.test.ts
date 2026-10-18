// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createMenus, handleMenuClick, MENU_IDS, type MenuDeps } from '@/src/background/context-menu';
import { DEFAULT_SETTINGS, type Settings } from '@/src/shared/settings';

function deps(settings: Partial<Settings> = {}) {
  const d: MenuDeps = {
    sendToTab: vi.fn(async () => {}),
    loadSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, ...settings })),
    saveSettings: vi.fn(async (patch: Partial<Settings>) => ({ ...DEFAULT_SETTINGS, ...settings, ...patch })),
  };
  return d;
}

const TAB = { id: 7, url: 'https://news.ycombinator.com/item?id=1' };

describe('createMenus', () => {
  it('先清空再创建：一个父菜单 + 4 个子菜单', async () => {
    const created: { id: string; parentId?: string }[] = [];
    const api = { removeAll: vi.fn(async () => {}), create: vi.fn((p: { id: string; parentId?: string }) => void created.push(p)) };
    await createMenus(api);
    expect(api.removeAll).toHaveBeenCalledBefore(api.create);
    expect(created[0]!.id).toBe(MENU_IDS.root);
    expect(created.slice(1).every((p) => p.parentId === MENU_IDS.root)).toBe(true);
    expect(created).toHaveLength(5);
  });
});

describe('handleMenuClick', () => {
  it('开关翻译与切换模式：发命令给被点击的标签页', async () => {
    const d = deps();
    await handleMenuClick(MENU_IDS.toggle, TAB, d);
    await handleMenuClick(MENU_IDS.mode, TAB, d);
    expect(d.sendToTab).toHaveBeenNthCalledWith(1, 7, { type: 'toggle' });
    expect(d.sendToTab).toHaveBeenNthCalledWith(2, 7, { type: 'toggle-mode' });
  });

  it('本站不自动翻译：按标签页的 hostname 切换名单', async () => {
    const d = deps({ neverSites: ['a.com'] });
    await handleMenuClick(MENU_IDS.never, TAB, d);
    expect(d.saveSettings).toHaveBeenCalledWith({ neverSites: ['a.com', 'news.ycombinator.com'] });
  });

  it('显示/隐藏悬浮球：按 hostname 切换隐藏名单', async () => {
    const d = deps({ ballHiddenSites: ['news.ycombinator.com'] });
    await handleMenuClick(MENU_IDS.ball, TAB, d);
    expect(d.saveSettings).toHaveBeenCalledWith({ ballHiddenSites: [] });
  });

  it('没有标签页、没有网址或未知菜单时什么都不做', async () => {
    const d = deps();
    await handleMenuClick(MENU_IDS.toggle, undefined, d);
    await handleMenuClick(MENU_IDS.never, { id: 1 }, d);
    await handleMenuClick(MENU_IDS.never, { id: 1, url: 'not a url' }, d);
    await handleMenuClick('unknown', TAB, d);
    expect(d.sendToTab).not.toHaveBeenCalled();
    expect(d.saveSettings).not.toHaveBeenCalled();
  });
});
