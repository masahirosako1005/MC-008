import { describe, expect, it } from 'vitest';
import { addDays, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { FADE_MAX_DAYS, FADE_SOON_NOTICE_DAYS, FADE_START_DAYS } from '@/domain/town/constants';
import { FadePolicy, fadeStartDate, stateFor } from '@/domain/town/FadePolicy';

/** テスト用: 日付 */
function d(text: string): LocalDate {
  const parsed = parseLocalDate(text);
  if (!parsed.ok) throw new Error(text);
  return parsed.value;
}

const LAST = d('2026-10-01');

/** テスト用: 最終訪問から days 日後の状態 */
function after(days: number): ReturnType<typeof stateFor> {
  return stateFor(LAST, addDays(LAST, days));
}

describe('stateFor', () => {
  it('訪問なしは never', () => {
    expect(stateFor(undefined, d('2026-11-09'))).toEqual({ kind: 'never' });
  });
  it('当日（d=0）は fresh', () => {
    expect(after(0)).toEqual({ kind: 'fresh', daysSinceVisit: 0 });
  });
  it('d=22 は fresh（そろそろの前日）', () => {
    expect(after(22)).toEqual({ kind: 'fresh', daysSinceVisit: 22 });
  });
  it('d=23 は soon（色あせまで 7 日）', () => {
    expect(after(23)).toEqual({ kind: 'soon', daysSinceVisit: 23, daysUntilFade: 7, fadeStartDate: d('2026-10-31') });
  });
  it('d=29 は soon（色あせまで 1 日）', () => {
    expect(after(29)).toEqual({ kind: 'soon', daysSinceVisit: 29, daysUntilFade: 1, fadeStartDate: d('2026-10-31') });
  });
  it('d=30 は fading（progress 0）', () => {
    expect(after(30)).toEqual({ kind: 'fading', daysSinceVisit: 30, progress: 0, fadeStartDate: d('2026-10-31') });
  });
  it('d=60 は fading（progress 0.5）', () => {
    const state = after(60);
    expect(state.kind).toBe('fading');
    if (state.kind === 'fading') expect(state.progress).toBeCloseTo(0.5, 10);
  });
  it('d=90 は fading（progress 1）', () => {
    expect(after(90)).toEqual({ kind: 'fading', daysSinceVisit: 90, progress: 1, fadeStartDate: d('2026-10-31') });
  });
  it('d=200 でも progress は 1 のまま（上限）', () => {
    expect(after(200)).toEqual({ kind: 'fading', daysSinceVisit: 200, progress: 1, fadeStartDate: d('2026-10-31') });
  });
  it('境界は constants.ts の定数どおり', () => {
    expect(after(FADE_START_DAYS - FADE_SOON_NOTICE_DAYS - 1).kind).toBe('fresh');
    expect(after(FADE_START_DAYS - FADE_SOON_NOTICE_DAYS).kind).toBe('soon');
    expect(after(FADE_START_DAYS - 1).kind).toBe('soon');
    expect(after(FADE_START_DAYS).kind).toBe('fading');
    const deepest = after(FADE_MAX_DAYS);
    expect(deepest.kind === 'fading' ? deepest.progress : -1).toBe(1);
  });
  it('progress は d について単調非減少で 0..1 に収まる', () => {
    let previous = 0;
    for (let days = FADE_START_DAYS; days <= 400; days += 1) {
      const state = after(days);
      if (state.kind !== 'fading') throw new Error('fading のはず');
      expect(state.progress).toBeGreaterThanOrEqual(previous);
      expect(state.progress).toBeGreaterThanOrEqual(0);
      expect(state.progress).toBeLessThanOrEqual(1);
      previous = state.progress;
    }
  });
  it('最終訪問日が今日より後（不正・日付巻き戻し）なら 0 日経過の fresh として扱う', () => {
    expect(stateFor(d('2026-11-20'), d('2026-11-09'))).toEqual({ kind: 'fresh', daysSinceVisit: 0 });
  });
  it('年末年始をまたいでも暦日差で判定する', () => {
    expect(stateFor(d('2026-12-15'), d('2027-01-14'))).toEqual({
      kind: 'fading',
      daysSinceVisit: 30,
      progress: 0,
      fadeStartDate: d('2027-01-14'),
    });
  });
  it('閏年の2月をまたいでも暦日差で判定する', () => {
    const state = stateFor(d('2028-02-01'), d('2028-02-24'));
    expect(state).toEqual({ kind: 'soon', daysSinceVisit: 23, daysUntilFade: 7, fadeStartDate: d('2028-03-02') });
  });
  it('同じ入力には同じ出力を返す（DI-05）', () => {
    expect(stateFor(LAST, d('2026-11-09'))).toEqual(stateFor(LAST, d('2026-11-09')));
  });
  it('結果は凍結されている（保存値として書き換えられない）', () => {
    expect(Object.isFrozen(after(25))).toBe(true);
    expect(Object.isFrozen(stateFor(undefined, LAST))).toBe(true);
  });
});

describe('fadeStartDate', () => {
  it('最終訪問日 + FADE_START_DAYS を返す', () => {
    expect(fadeStartDate(d('2026-10-01'))).toBe('2026-10-31');
    expect(fadeStartDate(d('2026-12-20'))).toBe('2027-01-19');
    expect(fadeStartDate(d('2028-02-01'))).toBe('2028-03-02');
  });
  it('名前空間 FadePolicy は名前付き export と同じ関数を指す', () => {
    expect(FadePolicy.stateFor).toBe(stateFor);
    expect(FadePolicy.fadeStartDate).toBe(fadeStartDate);
  });
});
