import { describe, expect, it } from 'vitest';
import { statusDateText } from '@/presentation/App/StatusBar';

describe('statusDateText', () => {
  it('日付をずらしていなければ日付だけ', () => {
    expect(statusDateText({ dateLabel: '2026/11/09（月）' })).toBe('2026/11/09（月）');
    expect(statusDateText({ dateLabel: '2026/11/09（月）', dayOffset: 0 })).toBe('2026/11/09（月）');
  });
  it('デモで日付を進めていれば「（+n日）」を付ける', () => {
    expect(statusDateText({ dateLabel: '2026/12/09（水）', dayOffset: 30 })).toBe('2026/12/09（水）（+30日）');
  });
});
