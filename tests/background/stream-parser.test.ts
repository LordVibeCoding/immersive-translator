// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createItemParser, createSseDecoder } from '@/src/background/stream-parser';

const sseLine = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe('createSseDecoder', () => {
  afterEach(() => vi.restoreAllMocks());

  it('解析跨 chunk 的 data 行，忽略 [DONE]、非 data 行和坏 JSON', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out: string[] = [];
    const decoder = createSseDecoder((t) => out.push(t));
    const raw = `: keep-alive\n${sseLine('你')}${sseLine('好')}data: {bad json}\n\ndata: [DONE]\n\n`;
    decoder.push(raw.slice(0, 20));
    decoder.push(raw.slice(20));
    decoder.end();
    expect(out).toEqual(['你', '好']);
  });

  it('end 时处理没有换行结尾的最后一行', () => {
    const out: string[] = [];
    const decoder = createSseDecoder((t) => out.push(t));
    decoder.push(sseLine('尾').trimEnd());
    decoder.end();
    expect(out).toEqual(['尾']);
  });
});

describe('createItemParser', () => {
  it('按编号切分，结束时交付最后一段', () => {
    const out: [number, string][] = [];
    const parser = createItemParser((i, t) => out.push([i, t]));
    parser.push('[1] 第一段\n[2] 第二');
    parser.push('段\n');
    parser.end();
    expect(out).toEqual([[1, '第一段'], [2, '第二段']]);
  });

  it('下一个编号一出现就交付上一段（不等整行结束）', () => {
    const out: [number, string][] = [];
    const parser = createItemParser((i, t) => out.push([i, t]));
    parser.push('[1] 第一段\n[2]');
    expect(out).toEqual([[1, '第一段']]);
  });

  it('续行拼接到上一段，忽略编号前的废话和空译文', () => {
    const out: [number, string][] = [];
    const parser = createItemParser((i, t) => out.push([i, t]));
    parser.push('好的，以下是翻译：\n[1] 上半句\n下半句\n[2]   \n[3] 三\n');
    parser.end();
    expect(out).toEqual([[1, '上半句下半句'], [3, '三']]);
  });
});
