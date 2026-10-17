/** 按换行切分的增量缓冲：完整行交给 onLine，残余留在缓冲区 */
function createLineBuffer(onLine: (line: string) => void) {
  let buffer = '';
  return {
    push(chunk: string): string {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(onLine);
      return buffer;
    },
    end(): void {
      if (buffer) onLine(buffer);
      buffer = '';
    },
  };
}

function extractDelta(data: string): string {
  try {
    const json = JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : '';
  } catch (err) {
    console.warn('[沉浸翻译] 无法解析 SSE 数据', data, err);
    return '';
  }
}

/** 解析 OpenAI 兼容接口的 SSE 流，回调每个增量文本 */
export function createSseDecoder(onDelta: (text: string) => void) {
  const lines = createLineBuffer((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice('data:'.length).trim();
    if (data === '[DONE]') return;
    const delta = extractDelta(data);
    if (delta) onDelta(delta);
  });
  return { push: (chunk: string) => void lines.push(chunk), end: () => lines.end() };
}

const ITEM_LINE = /^\s*\[(\d+)\]\s*(.*)$/;
const ITEM_START = /^\s*\[\d+\]/;

/** 把模型输出切成「[编号] 译文」：下一个编号出现或流结束时交付上一段 */
export function createItemParser(onItem: (index: number, text: string) => void) {
  let current: { readonly index: number; readonly text: string } | null = null;

  const emit = () => {
    if (current && current.text.trim()) onItem(current.index, current.text.trim());
    current = null;
  };

  const lines = createLineBuffer((line) => {
    const match = ITEM_LINE.exec(line);
    if (match) {
      emit();
      current = { index: Number(match[1]), text: match[2] ?? '' };
    } else if (current && line.trim()) {
      current = { ...current, text: current.text + line.trim() };
    }
  });

  return {
    push(delta: string): void {
      const rest = lines.push(delta);
      if (ITEM_START.test(rest)) emit();
    },
    end(): void {
      lines.end();
      emit();
    },
  };
}
