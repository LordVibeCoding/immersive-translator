# 自用沉浸式翻译插件 — 设计文档

日期：2026-10-18

## 1. 目标

在 Chrome 上浏览英文网页时，可以随时在「原文 / 双语对照 / 只看译文」之间切换，翻译要**快**：
眼前这一屏应该几乎瞬间出现译文，并在后台自动升级成大模型精翻。

### 范围（MVP）

- 浏览器：仅正版 Chrome（依赖 Chrome 内置 Translator API）
- 方向：英文 → 简体中文（固定，不做配置）
- 场景：普通英文网站、技术文档/博客、Twitter/Reddit 等动态信息流
- 不做：PDF、视频字幕、划词翻译、术语表、多语言方向、保留段内链接/加粗格式

## 2. 核心策略：双引擎接力

1. **本地初稿**：Chrome 内置 `Translator` API（本机离线模型），每段并行翻译，几十毫秒出结果，半透明显示。
2. **大模型精翻**：OpenAI 兼容接口（用户自填 baseURL / apiKey / model），多段打包成一个请求、流式返回，每段一生成完就替换初稿，恢复正常不透明度。
3. **缓存**：精翻结果存 IndexedDB，命中则直接显示终稿，跳过两个引擎。

**质量等级只升不降**：每个段落记录当前等级 `none < draft < final`，低等级结果不能覆盖高等级结果（解决缓存命中先于本地初稿返回等竞态）。

**降级**：
- 未配置大模型 → 只用本地翻译，本地结果直接作为终态显示（不透明）。
- 本地 Translator 不可用（模型未下载 / 环境不支持）→ 只走大模型。
- 大模型请求失败 → 保留本地初稿，在弹窗中显示最近一次错误。不自动重试。

## 3. 架构

```
┌────────── 内容脚本（每个页面）──────────┐
│ controller   编排：开关、模式、调度       │
│ scanner      找可翻译段落 + 视口优先级     │
│ text-filter  判断一段文字要不要翻         │
│ local-engine Chrome Translator API 封装  │
│ renderer     插入译文、切换显示模式        │
└──────────────┬──────────────────────────┘
               │ chrome.runtime port（长连接）
┌──────────────▼──── 后台 Service Worker ──┐
│ port-handler 接收请求、回推结果           │
│ cache        IndexedDB 精翻缓存           │
│ batch-queue  攒批 + 全局并发控制          │
│ llm-client   OpenAI 兼容流式请求          │
│ stream-parser 把流式文本切成「[编号] 译文」 │
└─────────────────────────────────────────┘
popup   当前页开关、模式、本站不自动翻译、本地模型状态/下载、最近错误
options 大模型配置（baseURL/apiKey/model）+ 测试连接、全局自动翻译开关
```

技术栈：TypeScript + WXT（MV3 插件框架）+ Vitest（单元/集成）+ Playwright（E2E）。UI 用原生 HTML/TS，不引框架。

### 为什么这样分

- Translator API 不在 Service Worker 中提供，必须在页面环境（内容脚本）调用；它是本地模型，无需攒批。
- 大模型请求放后台：API Key 不暴露给网页，无 CORS 问题，所有标签页共享一个并发队列。
- 缓存放后台：扩展源下的 IndexedDB 全局共享。

## 4. 组件设计

### 4.1 scanner（找段落）

- 用 TreeWalker 遍历文本节点；对每个含有效文字的文本节点，向上找到**最近的非行内祖先**作为「段落块」。
  （v0.2.2 起）是否「行内」按**实际渲染样式**判断：`display: inline/contents` 才并进段落；绝对/固定定位的元素（如「New」徽章）、
  块级或 flex 化的 `<a>/<span>`（如下拉菜单项）、`inline-block` 的徽章胶囊都单独成段；`inline-block` 的 `code/kbd` 等正文标签仍并进段落；
  拿不到计算样式时按下面的标签集合判断。
  行内标签集合：`a b strong i em span code small sup sub mark abbr time label u s br img font cite q kbd var samp del ins wbr`。
- 跳过区域（行内 `code` 属于正文不跳过，代码块由 `pre` 跳过）：`pre script style noscript textarea input select svg math [contenteditable] [translate=no] .notranslate`，以及插件自己插入的节点。
  （v0.2.4 起）加在 `<html>`/`<body>` 上的 `translate="no"` / `.notranslate` 整页标记忽略——React/Next.js 网站（如 OpenSea）用它防止浏览器整页翻译改动 DOM，并非内容不可翻译；网页内部元素上的标记仍然尊重。
- 页面时机（v0.2.4 起）：「脆弱」页面（`<html>`/`<body>` 有不翻译标记，或 Next.js 特征）等 `load`（最多 5s）+ 浏览器空闲后再开始翻译，减少在 React 接管（hydration）前改动 DOM 导致的 React #418 报错；悬浮球在所有页面都等页面稳定后再挂载。实测 OpenSea 详情页报错率由 4/5 降至 2/8，报错仅出现在控制台，React 重渲染后自动重译（命中缓存），网站功能不受影响。
- 本地翻译手势（v0.2.4 起）：只有产生用户激活的操作才尝试创建翻译器（单独按 Option/Esc 不消耗监听），创建失败则继续等下一次操作。
- 去重：段落块用 `WeakSet`/data 属性标记，嵌套时只取最内层块。
- **视口优先**：每个段落块交给 `IntersectionObserver`（`rootMargin: "100% 0px"`，即提前一屏），进入范围才翻译。
- **动态内容**：`MutationObserver` 监听新增节点，300ms 防抖后扫描新增子树；已翻译段落的原文变化（如 React 重渲染）时重新翻译。

### 4.2 text-filter（要不要翻）

不翻：去空白后少于 3 个字符；不超过 3 个词且没有小写字母（如 NEW、FREE、US ONLY、TTL），或被样式设成全大写显示（`text-transform: uppercase`）的不超过 3 个词的短文字——视为徽章/缩写；不含英文单词；中日韩字符数 /（中日韩字符数 + 英文单词数）> 30%；纯 URL。

### 4.3 local-engine

- `Translator.availability({sourceLanguage:'en', targetLanguage:'zh'})`，`available` 时直接 `Translator.create()`，每页一个实例。
- **按来源报告可用性**：为防指纹，Chrome 按网站来源（origin）报告可用性——即使模型已在浏览器中装好，新网站也报 `downloadable`；
  在该来源调用 `create()` 需要页面上的用户激活（点击/按键），模型已装好时会立即完成，之后该来源报 `available`。
- 因此 `downloadable/downloading` 时，内容脚本在 `window` 上注册一次性的 `pointerdown`/`keydown` 监听（捕获阶段），
  页面上第一次点击或按键时移除监听并在事件处理函数内调用 `create()`，成功后通过 `controller.setLocalEngine()` 注入；
  此前已登记但尚无终稿的段落顺带补上本地翻译。效果：每个网站第一次需要在页面上点一下才有本地初稿。
- `unavailable` / 全局 `Translator` 不存在时不注册监听，视为不可用。
- popup 里看到的是扩展来源的可用性；popup 的「下载本地模型」按钮用于真正下载模型文件（只需一次）。
- 本地引擎创建放在消息监听注册之后，不阻塞 popup/快捷键；`available` 时等创建完成再自动开启，让首批段落用上本地初稿。
- **风险**：需要在实现第一步验证 Translator API 在内容脚本隔离世界中可用。若不可用，退路是由后台创建 offscreen document 承载本地翻译。

### 4.4 renderer（显示）

- 译文以自定义元素 `<it-tr>` 追加为段落块的**最后一个子节点**（`display:block`），不改动原有 DOM 结构（避免与 React 等框架冲突）。
- 记录每块的质量等级，只升不降；`draft` 加 `it-draft` 类（`opacity: .6`）。
- 模式由 `<html>` 上的类控制，切换瞬间完成、不重复翻译：
  - 关闭：`html:not(.it-on) it-tr { display:none !important }`
  - 双语：`html.it-on it-tr { display:block !important }`（显隐规则用 `!important`，防止网站 `.x > * {display:block}` 之类规则干扰）
  - 双语（v0.2.3 起）：段落本身是弹性/网格布局（如横排菜单项）时，译文加 `it-inline`，以 `inline-block` 不换行地跟在原文后面，避免被挤成逐字竖排的格子。
  - 只看译文（v0.2.1 起）：`<it-tr>` 隐藏，译文**原地写进原文的文字节点**——写入段落中最长的文字节点（保留其首尾空白），
    其余自身文字节点清空；只改文字、不动元素，表单控件、图标、按钮和表格布局保持原样。
    切回双语或关闭翻译时换回原文（网站自己改过的节点保留网站的新内容）。替换后的中文不会被当成原文变化重复请求（文本过滤会拒绝中文）。
    旧实现（`font-size:0` + 隐藏行内子元素 + 块级译文）在网页应用中会隐藏包在 span 里的输入框/下拉框、把块级译文塞进按钮导致重叠，已废弃。
- 译文元素设置 `white-space: normal`；父元素的行数截断（line-clamp）不做特殊处理。

### 4.5 controller（编排）

- 页面加载：读取设置；若「自动翻译」开且本站不在黑名单，且页面主要是英文（抽样正文，拉丁字母占比判断），则开启。
- 段落进入视口 → 加入待翻队列 → 每 50ms 冲刷一次：
  1. 本地引擎可用 → 并行本地翻译，结果以 `draft` 渲染（未配置大模型时以 `final` 渲染）。
  2. 大模型已配置 → 把这批段落通过 port 发后台。
- 快捷键（`chrome.commands`，可在 chrome://extensions/shortcuts 修改）：
  - `Alt+A`：开关翻译（首次开启触发扫描）
  - `Alt+S`：双语 ⇄ 只看译文
- popup 通过 `chrome.tabs.sendMessage` 获取/修改当前页状态。

### 4.6 后台：cache

- `idb-keyval`，key = `SHA-256(model + "\n" + 原文)`，value = 译文。
- MVP 不做淘汰（文本体积小，已知限制）。

### 4.7 后台：batch-queue + llm-client + stream-parser

- 收到段落后先查缓存，命中立即回推 `final`；未命中进入队列。
- 攒批：满 20 段或 2500 字符立即发送，否则 150ms 后发送；全局最多 3 个并发请求。
- 请求：`POST {baseURL}/chat/completions`，`stream: true`，`temperature: 0`。
  - system：专业英译中译者，结合页面标题作为语境，保持术语/代码/专有名词原样，只输出译文。
  - 输入每段折叠空白为单行：`[1] text`；要求按相同编号逐行输出 `[1] 译文`。
- 流式解析：SSE `data:` 行 → `choices[0].delta.content` 累积 → 按换行切分，匹配 `^\[(\d+)\]\s*(.*)$`；下一个 `[编号]` 一出现或流结束时，上一段视为完成，立即回推并写缓存；不带编号的行视为上一段的续行。
- 结束时缺失的编号：不回推（保持本地初稿）。
- 失败（网络错误、非 2xx、超过 30 秒超时）：记录最近错误到 `chrome.storage.session`，本批未完成的段落不回推（已回推的保留）。

### 4.8 消息协议（内容脚本 ⇄ 后台，port 名 `translate`）

```ts
// content → background
{ type: 'translate', pageTitle: string, items: { id: string; text: string }[] }
// background → content
{ type: 'result', id: string, text: string }   // 均为 final
```

### 4.9 设置（chrome.storage.local）

```ts
{
  llm: { baseURL: string; apiKey: string; model: string }, // 任一为空视为未配置
  autoTranslate: boolean,      // 默认 true
  neverSites: string[],        // hostname 黑名单
  mode: 'dual' | 'only',       // 默认 dual；仅作为新页面的默认模式，各标签页模式互相独立、不跨页同步
}
```

## 5. 测试策略

- **单元（Vitest + happy-dom）**：text-filter、scanner 找块规则、stream-parser（含跨 chunk 断行）、batch-queue 攒批/并发、renderer 等级只升不降和模式类、缓存 key。
- **集成**：llm-client + stream-parser，用模拟 fetch 返回 SSE 流；port-handler 缓存命中/未命中流程。
- **E2E（Playwright + 内置 Chromium 加载插件）**：本地测试页 + 本地模拟 OpenAI 兼容服务。
  验证：开启后译文出现、快捷模式切换、动态插入节点被翻译、缓存二次命中。
  注意：Playwright 的 Chromium 没有 Translator 模型、正版 Chrome 137+ 已禁用 `--load-extension`，
  因此 E2E 覆盖「仅大模型」路径；本地引擎路径在正版 Chrome 中手工验证。
- 覆盖率目标：`src/` 下逻辑模块 ≥ 80%。

## 6. 已知限制

- 段内链接/加粗在译文中丢失（双语模式可点原文链接）。后续可通过大模型占位标记保留。
- 缓存无淘汰。
- 仅英 → 中。

## 7. 追加：悬浮球与右键菜单（v0.2.0）

- **悬浮球**（`src/content/floating-ball.ts`、`ball-mount.ts`）：自定义元素 `<it-ball>` 挂在 `<html>` 下，内容放在 Shadow DOM 中与网站样式隔离，也不会被段落扫描到。平时贴右边缘只露半个球，悬停滑出并展开菜单。单击开关本页翻译；菜单可切换模式、本站不自动翻译、本站隐藏悬浮球；上下拖动的位置以视口比例保存为 `ballTop`。
- **右键菜单**（`src/background/context-menu.ts`）：安装/更新时重建「沉浸翻译」子菜单。开关、切换模式发命令给被点击的标签页；「本站不自动翻译」「本站显示/隐藏悬浮球」直接修改设置中的站点名单（`neverSites` / `ballHiddenSites`），内容脚本监听设置变化同步悬浮球。
- 各标签页的开关与模式互相独立；站点名单与悬浮球位置为全局设置。
