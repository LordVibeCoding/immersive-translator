import { streamTranslate } from '@/src/background/llm-client';
import { isLlmConfigured, isValidBaseURL, loadSettings, saveSettings, type LlmConfig } from '@/src/shared/settings';

const input = (id: string) => document.getElementById(id) as HTMLInputElement;

function showStatus(text: string, ok = true): void {
  const el = document.getElementById('status')!;
  el.textContent = text;
  el.className = ok ? 'ok' : 'warn';
}

function readForm(): LlmConfig {
  return { baseURL: input('baseURL').value.trim(), apiKey: input('apiKey').value.trim(), model: input('model').value.trim() };
}

/** 三项要么全空（不用大模型），要么全填且地址合法 */
function validate(llm: LlmConfig): string | null {
  const filled = [llm.baseURL, llm.apiKey, llm.model].filter(Boolean).length;
  if (filled === 0) return null;
  if (filled < 3) return '接口地址、API Key、模型需要全部填写（或全部留空）';
  if (!isValidBaseURL(llm.baseURL)) return '接口地址必须是 http:// 或 https:// 开头的网址';
  return null;
}

async function testConnection(): Promise<void> {
  const llm = readForm();
  const error = validate(llm) ?? (isLlmConfigured(llm) ? null : '请先填写大模型配置');
  if (error) return showStatus(error, false);
  showStatus('测试中…');
  const started = performance.now();
  try {
    let result = '';
    await streamTranslate(llm, '连接测试', ['Hello, world! This is a translation test.'], (_i, text) => {
      result = text;
    });
    const ms = Math.round(performance.now() - started);
    if (result) showStatus(`✅ ${result}（耗时 ${ms}ms）`);
    else showStatus('⚠️ 请求成功，但没有解析到译文：模型可能没有按「[编号] 译文」格式输出', false);
  } catch (err) {
    showStatus(`❌ ${err instanceof Error ? err.message : String(err)}`, false);
  }
}

async function main(): Promise<void> {
  const settings = await loadSettings();
  input('baseURL').value = settings.llm.baseURL;
  input('apiKey').value = settings.llm.apiKey;
  input('model').value = settings.llm.model;
  input('autoTranslate').checked = settings.autoTranslate;

  document.getElementById('form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const llm = readForm();
    const error = validate(llm);
    if (error) return showStatus(error, false);
    await saveSettings({ llm, autoTranslate: input('autoTranslate').checked });
    showStatus('已保存，刷新网页后生效');
  });
  document.getElementById('test')!.addEventListener('click', () => void testConnection());
}

void main();
