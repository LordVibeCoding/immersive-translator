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
    // 浏览器的 keep-alive 连接要等 context 关闭才会断开；若先关服务器会导致 close() 卡住，
    // 这里强制断开所有连接，保证测试收尾时不被 fixture 执行顺序卡死
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
