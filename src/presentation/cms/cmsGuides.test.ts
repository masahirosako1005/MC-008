/**
 * @file 店舗CMS の入力の手がかり・来店データの要約のテスト（presentation/cms 層）
 */
import { describe, expect, it } from 'vitest';
import type { CmsCountDto, CmsVisitStatsDto } from '@/application/dto/CmsDto';
import { SHOP_EVENT_DESCRIPTION_MAX, SHOP_EVENT_TITLE_MAX } from '@/domain/revisit/constants';
import { keyPointOf, largest } from '@/presentation/cms/cmsInsights';
import { EVENT_TEMPLATES, nextDateOfWeekday, periodOfPreset } from '@/presentation/cms/cmsTemplates';

/** テスト用の項目 */
function c(label: string, value?: number): CmsCountDto {
  return value === undefined ? { label, suppressed: true } : { label, value, suppressed: false };
}

describe('periodOfPreset', () => {
  it('2026-11-09（月）から: 今日だけ・次の土日・1週間・2週間・今月末まで', () => {
    expect(periodOfPreset('today', '2026-11-09')).toEqual({ start: '2026-11-09', end: '2026-11-09' });
    expect(periodOfPreset('weekend', '2026-11-09')).toEqual({ start: '2026-11-14', end: '2026-11-15' });
    expect(periodOfPreset('week', '2026-11-09')).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(periodOfPreset('twoWeeks', '2026-11-09')).toEqual({ start: '2026-11-09', end: '2026-11-22' });
    expect(periodOfPreset('month', '2026-11-09')).toEqual({ start: '2026-11-09', end: '2026-11-30' });
  });

  it('土曜は今日と明日、日曜は今日だけを「次の土日」にする（過去の日は選ばない）', () => {
    expect(periodOfPreset('weekend', '2026-11-14')).toEqual({ start: '2026-11-14', end: '2026-11-15' });
    expect(periodOfPreset('weekend', '2026-11-15')).toEqual({ start: '2026-11-15', end: '2026-11-15' });
  });
});

describe('nextDateOfWeekday', () => {
  it('今日以降でいちばん近いその曜日（今日がその曜日なら今日）', () => {
    expect(nextDateOfWeekday('2026-11-09', '土')).toBe('2026-11-14');
    expect(nextDateOfWeekday('2026-11-09', '月')).toBe('2026-11-09');
    expect(nextDateOfWeekday('2026-11-09', '日')).toBe('2026-11-15');
    expect(nextDateOfWeekday('2026-11-09', 'x')).toBe('2026-11-09');
  });
});

describe('EVENT_TEMPLATES', () => {
  it('例の文面はそのまま登録できる字数に収まる', () => {
    for (const template of [...EVENT_TEMPLATES.coupon, ...EVENT_TEMPLATES.event]) {
      expect([...template.title].length).toBeLessThanOrEqual(SHOP_EVENT_TITLE_MAX);
      expect([...template.description].length).toBeLessThanOrEqual(SHOP_EVENT_DESCRIPTION_MAX);
    }
  });
});

describe('keyPointOf', () => {
  const stats: CmsVisitStatsDto = {
    isDummy: true, today: '2026-11-09', visits30d: c('訪問', 200), visitors30d: c('人', 120), revisitRatePct: 30, firstTimerPct: 40,
    weekly: [c('1週前', 50), c('直近7日', 60)],
    byWeekday: [{ label: '月', suppressed: false, note: '定休日' }, c('火', 20), c('水', 20), c('木', 20), c('金', 20), c('土', 50), c('日', 40)],
    byTimeBand: [c('朝（〜11時）', 10), c('昼（11〜14時）', 70), c('夜（20時〜）')],
    effects: [],
  };

  it('いちばん多い曜日と時間帯を1行（24字以内・括弧なし）にする', () => {
    const point = keyPointOf(stats);
    expect(point).toEqual({ text: '土曜の11〜14時が最も多い', weekday: '土' });
    expect([...(point?.text ?? '')].length).toBeLessThanOrEqual(24);
    expect(point?.text).not.toMatch(/[（）()]/);
  });

  it('表に無い時間帯の名前はそのまま出す', () => {
    expect(keyPointOf({ ...stats, byTimeBand: [c('深夜', 30)] })?.text).toBe('土曜の深夜が最も多い');
  });

  it('秘匿した項目（少数）・定休日は比べない', () => {
    expect(largest([c('a'), c('b', 3)])?.label).toBe('b');
    expect(largest([c('a'), { label: 'b', suppressed: false, note: '定休日' }])).toBeUndefined();
  });
});
