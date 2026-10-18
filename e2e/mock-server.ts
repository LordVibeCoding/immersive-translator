import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockServer {
  readonly url: string;
  readonly llmRequests: () => number;
  readonly close: () => Promise<void>;
}

/**
 * #p1 上的网站样式模拟 `.x > * { display:block }` 之类规则，用于验证关闭翻译时译文仍被隐藏；
 * #mix 是混合块（裸文本 + 子段落），子段落被高占位推到视口（含提前量）之外，
 * 用于验证只看译文模式下子段落不被隐藏、滚动到后仍会被翻译。
 * #dns 模拟网页应用里的表格：标签 + 包在 span 里的下拉框/输入框 + 带图标的按钮，表单控件继承字体，
 * 用于验证只看译文模式不破坏表单控件和布局。
 * #nav 模拟网站导航：菜单项带绝对定位的 New 徽章，下拉菜单项是 display:block 的 <a>，
 * 用于验证它们各自成段翻译，不会被拼成一整段。
 */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Test Page</title>
<style>#p1 > * { display: block; } input, select, button { font: inherit; }</style></head><body>
<nav id="nav"><ul><li style="position:relative">
<a id="nav-sec" href="#">Security <span id="badge" style="position:absolute;top:-8px;font-size:10px">New</span></a>
<div id="dd"><a id="dd1" href="#" style="display:block">SSL Certificates</a><a id="dd2" href="#" style="display:block">Domain Privacy</a></div>
</li></ul></nav>
<p id="p1">The quick brown fox jumps over the lazy dog.</p>
<p id="p2">Hello <a href="#">world</a>, this is a <b>test</b>.</p>
<pre id="code">const x = 1;</pre>
<table id="dns"><tr>
<td id="type-cell"><label class="lbl">Type</label> <span class="wrap"><select id="sel"><option>A Record</option></select></span></td>
<td><span class="wrap"><input id="host" value="@"></span></td>
<td><button id="edit"><i class="icon">✎</i> Edit</button></td>
</tr></table>
<div id="mix">Lead text <div style="height: 3000px"></div><p id="mixp">Child paragraph text.</p></div>
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
    // 浏览器的 keep-alive 连接要等 context 关闭才会断开；若先关服务器会导致 close() 卡住，
    // 这里强制断开所有连接，保证测试收尾时不被 fixture 执行顺序卡死
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
