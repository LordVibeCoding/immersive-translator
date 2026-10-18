#!/usr/bin/env bash
# 构建插件并同步到固定的本地目录，供 chrome://extensions「加载已解压的扩展程序」长期使用。
# 目录固定不变，Chrome 里的插件和设置都会保留，更新后只需在扩展页点刷新。
# 用法：pnpm local            （默认目录 ~/Chrome插件/沉浸翻译）
#       pnpm local /自定义/目录
set -euo pipefail

DEST="${1:-$HOME/Chrome插件/沉浸翻译}"

pnpm build
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R .output/chrome-mv3 "$DEST"

echo ""
echo "✅ 已同步到：$DEST"
echo "首次使用：chrome://extensions → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择上面的目录"
echo "之后更新：在 chrome://extensions 点插件卡片上的刷新按钮 ↻，再刷新已打开的网页"
