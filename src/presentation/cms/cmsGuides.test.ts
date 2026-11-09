/**
 * @file 店舗CMS の入力の手がかり・来店データの要約のテスト（presentation/cms 層）
 */
import { describe, expect, it } from 'vitest';
import type { CmsCountDto, CmsVisitStatsDto } from '@/application/dto/CmsDto';
import { SHOP_EVENT_DESCRIPTION_MAX, SHOP_EVENT_TITLE_MAX } from '@/domain/revisit/constants';
import { insightsOf, largest } from '@/presentation/cms/cmsInsights';
import { EVENT_TEMPLATES, periodOfPreset } from '@/presentation/cms/cmsTemplates';

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

describe('EVENT_TEMPLATES', () => {
  it('例の文面はそのまま登録できる字数に収まる', () => {
    for (const template of [...EVENT_TEMPLATES.coupon, ...EVENT_TEMPLATES.event]) {
      expect([...template.title].length).toBeLessThanOrEqual(SHOP_EVENT_TITLE_MAX);
      expect([...template.description].length).toBeLessThanOrEqual(SHOP_EVENT_DESCRIPTION_MAX);
    }
  });
});

describe('insightsOf', () => {
  const stats: CmsVisitStatsDto = {
    isDummy: true, today: '2026-11-09', visits30d: c('訪問', 200), visitors30d: c('人', 120), revisitRatePct: 30, firstTimerPct: 40,
    weekly: [c('1週前', 50), c('今週', 60)],
    byWeekday: [c('月', 20), c('火', 20), c('水', 20), c('木', 20), c('金', 20), c('土', 50), c('日', 40)],
    byTimeBand: [c('朝（〜10時）', 10), c('昼（11〜13時）', 70), c('夜（20時〜）')],
    effects: [],
  };

  it('いちばん多い曜日（平日比）・時間帯・週の変化・ヒントを出す', () => {
    expect(insightsOf(stats)).toEqual([
      'いちばん多いのは土曜日。平日の平均の約2.5倍です。',
      '時間帯では昼（11〜13時）がいちばん多いです。',
      '今週は先週より20%多くなっています。',
      'ヒント：土曜日の昼に向けたクーポンやイベントは、来店のきっかけになりやすいかもしれません。',
    ]);
  });

  it('秘匿した項目（少数）は比べない', () => {
    expect(largest([c('a'), c('b', 3)])?.label).toBe('b');
    expect(largest([c('a'), c('b')])).toBeUndefined();
  });
});
