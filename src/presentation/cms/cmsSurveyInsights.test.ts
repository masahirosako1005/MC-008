/**
 * @file アンケートのまとめのテスト（presentation/cms 層）
 * 改善ポイント（声の多い順・手だて・協力店だけ掲載）と、施策の打ち時（下がり気味・低い曜日・高い曜日・また来たい）を確かめる。
 */
import { describe, expect, it } from 'vitest';
import type { CmsSurveyChoiceDto, CmsSurveyDto, CmsSurveySlotDto } from '@/application/dto/CmsDto';
import { improvementPoints, timingPoints } from '@/presentation/cms/cmsSurveyInsights';

/** 選択肢の項目を作る */
function choice(key: string, label: string, count: number, total: number): CmsSurveyChoiceDto {
  return { key, label, count, pct: Math.round((count / total) * 100) };
}

/** 曜日別の項目を作る（月〜日。平均は渡したものだけ） */
function weekdays(avgs: Readonly<Record<string, number>>, concerns: Readonly<Record<string, string>> = {}): readonly CmsSurveySlotDto[] {
  return ['月', '火', '水', '木', '金', '土', '日'].map((label) => {
    const avg = avgs[label];
    const topConcern = concerns[label];
    return { label, count: avg === undefined ? 1 : 6, ...(avg === undefined ? {} : { avg }), ...(topConcern === undefined ? {} : { topConcern }) };
  });
}

/** テスト用の集計（2026-11-10 は火曜。回答40件） */
function surveyOf(over: Partial<CmsSurveyDto> = {}): CmsSurveyDto {
  return {
    today: '2026-11-10', windowDays: 30, total: 40, sampleCount: 40, satisfactionAvg: 4, satisfaction: [], revisitPct: 60,
    triggers: [], goods: [],
    concerns: [choice('wait', '待ち時間', 14, 40), choice('price', '価格', 2, 40), choice('info', '情報の少なさ', 6, 40), choice('hours', '営業時間', 5, 40), choice('lineup', '品ぞろえ', 5, 40)],
    byWeekday: weekdays({}), byTimeBand: [], comments: [],
    ...over,
  };
}

describe('improvementPoints', () => {
  it('声の多い順に3つまで。少ない声（2件）は挙げない', () => {
    const points = improvementPoints(surveyOf(), true);
    expect(points.map((p) => p.key)).toEqual(['wait', 'info', 'hours']);
    expect(points[0]).toMatchObject({ tag: '35%', text: '待ち時間', action: { page: 'events', label: '掲載する' } });
    expect(points[1]).toMatchObject({ action: { page: 'info', label: '編集' } });
  });

  it('協力店でなければ掲載のボタンは出さない（編集は出す）', () => {
    const points = improvementPoints(surveyOf(), false);
    expect(points[0]?.action).toBeUndefined();
    expect(points[1]?.action?.page).toBe('info');
  });

  it('回答が少ないうちは何も出さない', () => {
    expect(improvementPoints(surveyOf({ total: 4 }), true)).toEqual([]);
    expect(timingPoints(surveyOf({ total: 4 }), true)).toEqual([]);
  });
});

describe('timingPoints', () => {
  it('下がり気味 → 低い曜日 → 高い曜日 の順に並べ、日付は次のその曜日', () => {
    const points = timingPoints(surveyOf({ recentAvg: 3.6, previousAvg: 4.2, byWeekday: weekdays({ 土: 3.2, 金: 4.6, 水: 4.1 }, { 土: '待ち時間' }), revisitPct: 80 }), true);
    expect(points.map((p) => p.key)).toEqual(['trend', 'weak', 'best']);
    expect(points[0]).toMatchObject({ tag: '今すぐ', sub: '4.2 → 3.6' });
    expect(points[1]).toMatchObject({ tag: '11/14まで', text: '土曜の満足度が低い', sub: '3.2・待ち時間' });
    expect(points[2]).toMatchObject({ tag: '11/13', action: { page: 'events', label: '金曜に掲載', period: { start: '2026-11-13', end: '2026-11-13' } } });
  });

  it('また来たい人が多ければ、今日から2週間の掲載をすすめる', () => {
    const points = timingPoints(surveyOf({ revisitPct: 78 }), true);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ key: 'revisit', tag: '今', action: { period: { start: '2026-11-10', end: '2026-11-23' } } });
    expect(timingPoints(surveyOf({ revisitPct: 78 }), false)[0]?.action).toBeUndefined();
  });

  it('差が小さければ何も出さない', () => {
    expect(timingPoints(surveyOf({ recentAvg: 3.9, previousAvg: 4, byWeekday: weekdays({ 土: 3.9, 金: 4.1 }) }), true)).toEqual([]);
  });
});
