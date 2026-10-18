import type { TabCommand } from '../shared/messages';
import type { DisplayMode } from '../shared/settings';

/** 命令作用对象：只需要 Controller 的这几个能力 */
export interface CommandTarget {
  readonly state: { readonly enabled: boolean; readonly mode: DisplayMode };
  toggle(): void;
  enable(): void;
  setMode(mode: DisplayMode): void;
}

/**
 * 处理 popup / 快捷键发来的命令，只作用于本标签页。
 * 模式不再跨标签页同步：保存的模式只作为新打开页面的默认值。
 */
export function applyTabCommand(
  target: CommandTarget,
  command: TabCommand,
  saveMode: (mode: DisplayMode) => void,
): void {
  if (command.type === 'toggle') target.toggle();
  if (command.type === 'toggle-mode') {
    const mode = target.state.mode === 'dual' ? 'only' : 'dual';
    target.setMode(mode);
    // 未开启翻译时切换模式看不到任何效果，顺便开启本页
    if (!target.state.enabled) target.enable();
    saveMode(mode);
  }
}
