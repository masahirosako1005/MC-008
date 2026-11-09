import { describe, expect, it } from 'vitest';
import { isSafeAttribute } from '@/Common/ui/dom';

describe('isSafeAttribute', () => {
  it('通常の属性は許可する', () => {
    expect(isSafeAttribute('data-testid', 'gear')).toBe(true);
    expect(isSafeAttribute('aria-label', '設定')).toBe(true);
    expect(isSafeAttribute('href', 'https://example.com/')).toBe(true);
    expect(isSafeAttribute('href', '#/map')).toBe(true);
  });
  it('イベントハンドラ属性（on*）を拒否する（大文字小文字を問わない）', () => {
    expect(isSafeAttribute('onclick', 'x')).toBe(false);
    expect(isSafeAttribute('ONload', 'x')).toBe(false);
    expect(isSafeAttribute(' onerror', 'x')).toBe(false);
  });
  it('srcdoc・style・formaction を拒否する', () => {
    for (const name of ['srcdoc', 'style', 'formaction', 'STYLE']) expect(isSafeAttribute(name, 'x')).toBe(false);
  });
  it('javascript: / vbscript: URL を拒否する（空白・制御文字・大文字での回避も拒否）', () => {
    for (const value of ['javascript:alert(1)', ' JavaScript:void(0)', 'java\tscript:x', '\u0001javascript:x', 'vbscript:msgbox']) {
      expect(isSafeAttribute('href', value)).toBe(false);
    }
  });
  it('空の属性名は拒否する', () => {
    expect(isSafeAttribute('', 'x')).toBe(false);
  });
});
