import { describe, expect, it } from 'vitest';
import { REVISIT_REASON_ORDER, REVISIT_REASON_STYLE } from '@/Common/ui/cards/RevisitReasonCard';

describe('REVISIT_REASON_STYLE', () => {
  it('5種別のラベルは 期限・取り返し・色あせ・未訪問・新着（CLAUDE.md 4.5）', () => {
    expect(REVISIT_REASON_ORDER.map((k) => REVISIT_REASON_STYLE[k].label)).toEqual(['期限', '取り返し', '色あせ', '未訪問', '新着']);
  });
  it('アイコンとラベルがすべて異なる（色だけに頼らず区別できる）', () => {
    const labels = new Set(REVISIT_REASON_ORDER.map((k) => REVISIT_REASON_STYLE[k].label));
    const icons = new Set(REVISIT_REASON_ORDER.map((k) => REVISIT_REASON_STYLE[k].icon));
    expect(labels.size).toBe(5);
    expect(icons.size).toBe(5);
  });
  it('アイコンは 時計・旗・かすれ円・コンパス・きらめき（docs/08 §10.3）', () => {
    expect(REVISIT_REASON_ORDER.map((k) => REVISIT_REASON_STYLE[k].icon)).toEqual(['clock', 'flag', 'fade', 'compass', 'sparkle']);
  });
  it('表示の優先順は 期限 → 取り返し → 色あせ → 未訪問 → 新着', () => {
    expect(REVISIT_REASON_ORDER).toEqual(['deadline', 'reclaim', 'fade', 'unvisited', 'new']);
  });
});
