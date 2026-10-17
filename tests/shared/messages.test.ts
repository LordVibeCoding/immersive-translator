import { describe, expect, it } from 'vitest';
import { isTabCommand, isTranslateRequest, isTranslateResult } from '@/src/shared/messages';

describe('消息类型守卫', () => {
  it('isTranslateRequest', () => {
    expect(isTranslateRequest({ type: 'translate', pageTitle: 't', items: [{ id: '1', text: 'a' }] })).toBe(true);
    expect(isTranslateRequest({ type: 'translate', pageTitle: 't', items: [{ id: 1, text: 'a' }] })).toBe(false);
    expect(isTranslateRequest({ type: 'translate', items: [] })).toBe(false);
    expect(isTranslateRequest(null)).toBe(false);
  });

  it('isTranslateResult', () => {
    expect(isTranslateResult({ type: 'result', id: '1', text: '你好' })).toBe(true);
    expect(isTranslateResult({ type: 'result', id: '1' })).toBe(false);
  });

  it('isTabCommand', () => {
    expect(isTabCommand({ type: 'toggle' })).toBe(true);
    expect(isTabCommand({ type: 'get-state' })).toBe(true);
    expect(isTabCommand({ type: 'toggle-mode' })).toBe(true);
    expect(isTabCommand({ type: 'other' })).toBe(false);
    expect(isTabCommand('toggle')).toBe(false);
  });
});
