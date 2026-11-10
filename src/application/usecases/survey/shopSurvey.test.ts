/**
 * @file お店のアンケートのテスト（application/usecases/survey 層）
 * 答えの検証（選択肢にある値だけ・字数）、送信（お店だけ・二重登録の防止）、CMS の集計（期間・サンプル・曜日別）を確かめる。
 */
import { describe, expect, it } from 'vitest';
import { ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { SpotId } from '@/Common/types/Id';
import { jstInstantOf } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import type { SurveyResponseRepository } from '@/application/ports/SurveyResponseRepository';
import { summarizeSurvey } from '@/application/usecases/cms/GetCmsSurveyUseCase';
import { sampleSurveyResponses } from '@/application/usecases/cms/surveySamples';
import { parseSurveyAnswers, SURVEY_COMMENT_MAX } from '@/application/usecases/survey/shopSurvey';
import type { SurveyResponse } from '@/application/usecases/survey/shopSurvey';
import { SubmitShopSurveyUseCase } from '@/application/usecases/survey/SubmitShopSurveyUseCase';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import { parseBusinessHoursText } from '@/domain/spot/BusinessHours';
import type { Spot } from '@/domain/spot/Spot';
import type { SpotRepository } from '@/domain/spot/SpotRepository';

/** 2026-11-10 は火曜 */
const TODAY = '2026-11-10' as LocalDate;
const SHOP_ID = 's_mm04' as SpotId;
const ANSWERS = { satisfaction: 4, trigger: 'app', goods: ['quality'], concerns: ['wait'], revisit: 'yes' };

/** 成功の値を取り出す（失敗ならテストを落とす） */
function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** テスト用の回答を作る */
function responseOf(id: number, date: string, hour: number, over: Partial<SurveyResponse> = {}): SurveyResponse {
  return { id: `aaaaaaaa-0000-4000-8000-${String(id).padStart(12, '0')}`, spotId: SHOP_ID, answeredAt: jstInstantOf(date as LocalDate, hour), satisfaction: 4, trigger: 'app', goods: [], concerns: [], revisit: 'yes', ...over };
}

/** テスト用のスポットの参照（お店1つ・名所1つ） */
const SPOTS = {
  findSpot: (id: SpotId) => (id === SHOP_ID ? ({ id, kind: 'shop' } as unknown as Spot) : id === 'l_mm01' ? ({ id, kind: 'landmark' } as unknown as Spot) : undefined),
} as unknown as SpotRepository;

describe('parseSurveyAnswers', () => {
  it('正しい答えを受け付け、ひとことは前後の空白を落とす', () => {
    expect(must(parseSurveyAnswers({ ...ANSWERS, comment: '  また来ます\r\n ' }))).toEqual({ ...ANSWERS, comment: 'また来ます' });
    expect(must(parseSurveyAnswers({ ...ANSWERS, comment: '   ' }))).toEqual(ANSWERS);
  });

  it('選択肢に無い値・範囲外の満足度・重複・長すぎるひとことを断る', () => {
    for (const bad of [{ satisfaction: 6 }, { satisfaction: 2.5 }, { trigger: 'tv' }, { goods: ['quality', 'quality'] }, { concerns: ['x'] }, { revisit: undefined }, { comment: 'あ'.repeat(SURVEY_COMMENT_MAX + 1) }]) {
      expect(parseSurveyAnswers({ ...ANSWERS, ...bad }).ok).toBe(false);
    }
  });
});

describe('SubmitShopSurveyUseCase', () => {
  /** メモリの保存先と、時刻を固定したユースケースを作る */
  function setup(visited = true): { readonly surveys: SurveyResponseRepository; readonly submit: SubmitShopSurveyUseCase } {
    const items: SurveyResponse[] = [];
    const surveys: SurveyResponseRepository = {
      list: async () => ok([...items]),
      append: async (response) => { if (!items.some((r) => r.id === response.id)) items.push(response); return okVoid(); },
      clear: async () => { items.length = 0; return okVoid(); },
    };
    const clock = { now: (): Instant => jstInstantOf(TODAY, 13), today: (): LocalDate => TODAY };
    const session = { load: async () => ok({ activeTravelerId: 't1' }) } as unknown as SessionRepository;
    const travelers = { findById: async () => ok({ hasVisited: (): boolean => visited }) } as unknown as TravelerRepository;
    return { surveys, submit: new SubmitShopSurveyUseCase({ spots: SPOTS, session, travelers, surveys, clock }) };
  }

  it('お店の回答を1件保存し、同じ送信は二重に残さない', async () => {
    const { surveys, submit } = setup();
    const input = { ...ANSWERS, operationId: 'bbbbbbbb-0000-4000-8000-000000000001', spotId: SHOP_ID };
    must(await submit.execute(input));
    must(await submit.execute(input));
    const stored = must(await surveys.list());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ spotId: SHOP_ID, satisfaction: 4, concerns: ['wait'] });
    expect(Object.keys(stored[0] ?? {})).not.toContain('travelerId');
  });

  it('訪問していないお店には答えられない', async () => {
    const { surveys, submit } = setup(false);
    const result = await submit.execute({ ...ANSWERS, operationId: 'bbbbbbbb-0000-4000-8000-000000000003', spotId: SHOP_ID });
    expect(!result.ok && result.error.code).toBe('SURVEY_VISIT_REQUIRED');
    expect(must(await surveys.list())).toHaveLength(0);
  });

  it('名所・無いお店・不正な答えは保存しない', async () => {
    const { surveys, submit } = setup();
    const operationId = 'bbbbbbbb-0000-4000-8000-000000000002';
    expect((await submit.execute({ ...ANSWERS, operationId, spotId: 'l_mm01' })).ok).toBe(false);
    expect((await submit.execute({ ...ANSWERS, operationId, spotId: 's_zz99' })).ok).toBe(false);
    expect((await submit.execute({ ...ANSWERS, satisfaction: 0, operationId, spotId: SHOP_ID })).ok).toBe(false);
    expect(must(await surveys.list())).toHaveLength(0);
  });
});

describe('summarizeSurvey', () => {
  it('期間内の回答だけを数え、平均・割合・曜日別を出す', () => {
    const responses = [
      responseOf(1, '2026-11-10', 12, { satisfaction: 5 }),
      responseOf(2, '2026-11-07', 12, { satisfaction: 2, concerns: ['wait'], revisit: 'unsure', comment: '待ちました' }),
      responseOf(3, '2026-11-07', 13, { satisfaction: 3, concerns: ['wait'], revisit: 'maybe' }),
      responseOf(4, '2026-10-31', 12, { satisfaction: 2, concerns: ['wait', 'price'], revisit: 'maybe' }),
      responseOf(5, '2026-10-01', 12, { satisfaction: 1 }),
    ];
    const survey = summarizeSurvey({ responses, sampleCount: 0, today: TODAY, hours: parseBusinessHoursText('11:00–17:00（月休）') });
    expect(survey.total).toBe(4);
    expect(survey.satisfactionAvg).toBe(3);
    expect(survey.revisitPct).toBe(25);
    expect(survey.concerns.find((c) => c.key === 'wait')).toMatchObject({ count: 3, pct: 75 });
    expect(survey.byWeekday.map((s) => s.label)).toEqual(['月', '火', '水', '木', '金', '土', '日']);
    expect(survey.byWeekday[0]).toMatchObject({ count: 0, note: '定休日' });
    expect(survey.byWeekday[5]).toMatchObject({ count: 3, avg: 2.3, topConcern: '待ち時間' });
    expect(survey.byWeekday[1]?.avg).toBeUndefined();
    expect(survey.comments).toEqual([{ date: '2026-11-07', satisfaction: 2, text: '待ちました' }]);
  });

  it('回答が無ければ平均・割合を出さない', () => {
    const survey = summarizeSurvey({ responses: [], sampleCount: 0, today: TODAY, hours: undefined });
    expect(survey).toMatchObject({ total: 0, sampleCount: 0 });
    expect(survey.satisfactionAvg).toBeUndefined();
    expect(survey.revisitPct).toBeUndefined();
  });
});

describe('sampleSurveyResponses', () => {
  const facts = { shop: { id: SHOP_ID, partner: true } as unknown as Spot, hours: parseBusinessHoursText('11:00–17:00（月休）'), hasCoupon: true };

  it('同じお店・同じ日なら同じ値で、すべて正しい答え・期間内・定休日と営業時間の外には置かない', () => {
    const samples = sampleSurveyResponses(facts, TODAY);
    expect(samples).toEqual(sampleSurveyResponses(facts, TODAY));
    expect(samples.length).toBeGreaterThanOrEqual(30);
    for (const sample of samples) expect(parseSurveyAnswers(sample).ok).toBe(true);
    const survey = summarizeSurvey({ responses: samples, sampleCount: samples.length, today: TODAY, hours: facts.hours });
    expect(survey.total).toBe(samples.length);
    expect(survey.byWeekday[0]?.count).toBe(0);
    expect(survey.byTimeBand.filter((b) => b.count > 0).map((b) => b.label)).not.toContain('夜（20時〜）');
  });
});
