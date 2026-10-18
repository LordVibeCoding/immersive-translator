import { describe, expect, it, vi } from 'vitest';
import { applyTabCommand, type CommandTarget } from '@/src/content/tab-commands';
import type { DisplayMode } from '@/src/shared/settings';

function fakeController(enabled: boolean, mode: DisplayMode) {
  const state = { enabled, mode };
  const target: CommandTarget = {
    get state() {
      return { ...state };
    },
    toggle: vi.fn(() => void (state.enabled = !state.enabled)),
    enable: vi.fn(() => void (state.enabled = true)),
    setMode: vi.fn((m: DisplayMode) => void (state.mode = m)),
  };
  return target;
}

describe('applyTabCommand', () => {
  it('toggle 只切换本页开关，不保存模式', () => {
    const controller = fakeController(true, 'dual');
    const saveMode = vi.fn();
    applyTabCommand(controller, { type: 'toggle' }, saveMode);
    expect(controller.state.enabled).toBe(false);
    expect(saveMode).not.toHaveBeenCalled();
  });

  it('toggle-mode 切换本页模式，并把新模式保存为新页面的默认值', () => {
    const controller = fakeController(true, 'dual');
    const saveMode = vi.fn();
    applyTabCommand(controller, { type: 'toggle-mode' }, saveMode);
    expect(controller.state).toEqual({ enabled: true, mode: 'only' });
    expect(saveMode).toHaveBeenCalledWith('only');
  });

  it('在未开启翻译的页面上 toggle-mode 会顺便开启本页翻译', () => {
    const controller = fakeController(false, 'only');
    applyTabCommand(controller, { type: 'toggle-mode' }, vi.fn());
    expect(controller.state).toEqual({ enabled: true, mode: 'dual' });
  });

  it('get-state 不改变任何状态', () => {
    const controller = fakeController(false, 'dual');
    const saveMode = vi.fn();
    applyTabCommand(controller, { type: 'get-state' }, saveMode);
    expect(controller.toggle).not.toHaveBeenCalled();
    expect(controller.enable).not.toHaveBeenCalled();
    expect(controller.setMode).not.toHaveBeenCalled();
    expect(saveMode).not.toHaveBeenCalled();
  });
});
