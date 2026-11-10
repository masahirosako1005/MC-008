/**
 * @file 店舗CMS のアンケート集計ユースケース（application/usecases/cms 層・読取系。docs/09 CMS-V02〜V06）
 * 利用者アプリのスポット詳細で答えたアンケート（匿名）を、お店ごとに直近 CMS_SURVEY_WINDOW_DAYS 日ぶん集計する。
 * 回答が集まるまでは、お店ごとに決まったサンプル（surveySamples）を足して返す（sampleCount でサンプルの数を示す）。
 * 返すのは集計だけ：満足度の平均と分布・また来たい割合・きっかけ・よかった／気になったところ・曜日別／時間帯別の満足度・
 * 直近14日とその前の14日の満足度・ひとこと。改善ポイントや打ち時の言葉は画面側（cmsSurveyInsights）が集計から作る。
 * 曜日・時間帯の平均は、回答が CMS_SURVEY_SLOT_MIN 件に満たないときは出さない（1件で大きく振れるため）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { dayOfWeekOf, daysBetween, epochMsOf, JST_OFFSET_MS, localDateOf, MS_PER_DAY } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import type { UseCase } from '@/application/AppServices';
import type { CmsShopInput, CmsSurveyChoiceDto, CmsSurveyCommentDto, CmsSurveyDto, CmsSurveySlotDto } from '@/application/dto/CmsDto';
import { findShop, loadOverlayAndToday } from '@/application/usecases/cms/cmsShopView';
import type { CmsDeps } from '@/application/usecases/cms/cmsShopView';
import { CMS_SURVEY_COMMENT_LIMIT, CMS_SURVEY_SLOT_MIN, CMS_SURVEY_TREND_DAYS, CMS_SURVEY_WINDOW_DAYS } from '@/application/usecases/cms/constants';
import { shopFactsOf, TIME_BANDS } from '@/application/usecases/cms/GetCmsVisitStatsUseCase';
import { sampleSurveyResponses } from '@/application/usecases/cms/surveySamples';
import { SURVEY_CONCERNS, SURVEY_GOODS, SURVEY_REVISIT_YES, SURVEY_SATISFACTION_MAX, SURVEY_SATISFACTION_MIN, SURVEY_TRIGGERS } from '@/application/usecases/survey/shopSurvey';
import type { SurveyChoice, SurveyResponse } from '@/application/usecases/survey/shopSurvey';
import { minutesOf, WEEKDAY_LABELS } from '@/domain/spot/BusinessHours';
import type { BusinessHours } from '@/domain/spot/BusinessHours';

const logger = createLogger('application/usecases/cms/GetCmsSurveyUseCase');

/** 1分のミリ秒 */
const MS_PER_MINUTE = 60_000;

/** 集計に使う回答（答えた日・曜日・時刻を先に求めておく） */
interface Answered {
  readonly response: SurveyResponse;
  readonly date: LocalDate;
  /** 今日から何日前か（今日＝0） */
  readonly daysAgo: number;
  /** 曜日（0=月 … 6=日） */
  readonly weekday: number;
  /** 0時からの分（JST） */
  readonly minute: number;
}

/**
 * 小数1桁に丸める。
 * @param value 値
 * @returns 丸めた値
 */
function round1(value: number): number { // audit-ignore: fnlog-missing 多数回呼ぶ小さな算術
  return Math.round(value * 10) / 10;
}

/**
 * 満足度の平均を求める（回答が min 件に満たなければ undefined）。
 * @param items 回答
 * @param min 要る件数
 * @returns 平均（小数1桁）
 */
function averageOf(items: readonly Answered[], min: number): number | undefined { // audit-ignore: fnlog-missing 項目ごとに呼ぶ小さな算術
  if (items.length < Math.max(1, min)) return undefined;
  return round1(items.reduce((acc, a) => acc + a.response.satisfaction, 0) / items.length);
}

/**
 * 選択肢ごとの数と割合を数える。
 * @param choices 選択肢
 * @param items 回答
 * @param picked 回答から、選んだ key の一覧を取り出す関数
 * @returns 選択肢の並びのままの項目
 */
function choiceCounts(choices: readonly SurveyChoice[], items: readonly Answered[], picked: (r: SurveyResponse) => readonly string[]): readonly CmsSurveyChoiceDto[] {
  const log = logger.fn('choiceCounts', { choices: choices.length, items: items.length });
  return log.exit(choices.map((c) => {
    const count = items.filter((a) => picked(a.response).includes(c.key)).length;
    return { key: c.key, label: c.label, count, pct: items.length === 0 ? 0 : Math.round((count / items.length) * 100) };
  }));
}

/**
 * 回答のまとまり（ある曜日・ある時間帯）を1項目にする。
 * @param label 名前
 * @param items そのまとまりの回答
 * @param note 数値の代わりに出す説明（定休日）
 * @returns 項目
 */
function slotOf(label: string, items: readonly Answered[], note?: string): CmsSurveySlotDto { // audit-ignore: fnlog-missing 項目ごとに呼ぶ小さな組み立て（summarizeSurvey で記録する）
  const avg = averageOf(items, CMS_SURVEY_SLOT_MIN);
  const top = choiceCounts(SURVEY_CONCERNS, items, (r) => r.concerns).reduce<CmsSurveyChoiceDto | undefined>((best, c) => (c.count > (best?.count ?? 1) ? c : best), undefined);
  return { label, count: items.length, ...(avg === undefined ? {} : { avg }), ...(top === undefined ? {} : { topConcern: top.label }), ...(note !== undefined && items.length === 0 ? { note } : {}) };
}

/**
 * 回答に、答えた日・曜日・時刻を付け、集計期間の中のものだけを残す。
 * @param responses 回答
 * @param today 今日
 * @returns 期間内の回答
 */
function answeredWithin(responses: readonly SurveyResponse[], today: LocalDate): readonly Answered[] {
  const log = logger.fn('answeredWithin', { count: responses.length, today });
  const items = responses.map((response): Answered => {
    const date = localDateOf(response.answeredAt);
    const msOfDay = (((epochMsOf(response.answeredAt) + JST_OFFSET_MS) % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
    return { response, date, daysAgo: daysBetween(date, today), weekday: (dayOfWeekOf(date) + 6) % 7, minute: Math.floor(msOfDay / MS_PER_MINUTE) };
  });
  return log.exit(items.filter((a) => a.daysAgo >= 0 && a.daysAgo < CMS_SURVEY_WINDOW_DAYS));
}

/**
 * ひとことを新しい順に並べる。
 * @param items 回答
 * @returns ひとこと（CMS_SURVEY_COMMENT_LIMIT 件まで）
 */
function commentsOf(items: readonly Answered[]): readonly CmsSurveyCommentDto[] {
  const log = logger.fn('commentsOf', { items: items.length });
  const spoken = items.filter((a) => a.response.comment !== undefined).sort((a, b) => (a.response.answeredAt < b.response.answeredAt ? 1 : -1));
  return log.exit(spoken.slice(0, CMS_SURVEY_COMMENT_LIMIT).map((a) => ({ date: a.date, satisfaction: a.response.satisfaction, text: a.response.comment ?? '' })));
}

/**
 * 回答を集計する（純粋関数。期間外の回答は数えない）。
 * @param input 回答（サンプルを含む）・サンプルの数・今日・営業時間
 * @returns 集計
 */
export function summarizeSurvey(input: { readonly responses: readonly SurveyResponse[]; readonly sampleCount: number; readonly today: LocalDate; readonly hours: BusinessHours | undefined }): CmsSurveyDto {
  const log = logger.fn('summarizeSurvey', { count: input.responses.length, today: input.today });
  const items = answeredWithin(input.responses, input.today);
  const closed = new Set(input.hours?.closedDays ?? []);
  const open = input.hours === undefined ? 0 : minutesOf(input.hours.open) ?? 0;
  const close = input.hours === undefined ? 1440 : minutesOf(input.hours.close) ?? 1440;
  const levels = Array.from({ length: SURVEY_SATISFACTION_MAX - SURVEY_SATISFACTION_MIN + 1 }, (_, i) => String(SURVEY_SATISFACTION_MAX - i)).map((key) => ({ key, label: key }));
  const bands = TIME_BANDS.map((b) => ({ band: b, items: items.filter((a) => a.minute >= b.from && a.minute < b.to) })).filter((b) => b.items.length > 0 || (b.band.from < close && b.band.to > open));
  const satisfactionAvg = averageOf(items, 1);
  const recentAvg = averageOf(items.filter((a) => a.daysAgo < CMS_SURVEY_TREND_DAYS), CMS_SURVEY_SLOT_MIN);
  const previousAvg = averageOf(items.filter((a) => a.daysAgo >= CMS_SURVEY_TREND_DAYS && a.daysAgo < CMS_SURVEY_TREND_DAYS * 2), CMS_SURVEY_SLOT_MIN);
  return log.exit({
    today: input.today,
    windowDays: CMS_SURVEY_WINDOW_DAYS,
    total: items.length,
    sampleCount: Math.min(input.sampleCount, items.length),
    ...(satisfactionAvg === undefined ? {} : { satisfactionAvg }),
    satisfaction: choiceCounts(levels, items, (r) => [String(r.satisfaction)]),
    ...(items.length === 0 ? {} : { revisitPct: Math.round((items.filter((a) => a.response.revisit === SURVEY_REVISIT_YES).length / items.length) * 100) }),
    triggers: choiceCounts(SURVEY_TRIGGERS, items, (r) => [r.trigger]),
    goods: choiceCounts(SURVEY_GOODS, items, (r) => r.goods),
    concerns: choiceCounts(SURVEY_CONCERNS, items, (r) => r.concerns),
    byWeekday: WEEKDAY_LABELS.map((label, i) => slotOf(label, items.filter((a) => a.weekday === i), closed.has(i) ? '定休日' : undefined)),
    byTimeBand: bands.map((b) => slotOf(b.band.label, b.items)),
    ...(recentAvg === undefined ? {} : { recentAvg }),
    ...(previousAvg === undefined ? {} : { previousAvg }),
    comments: commentsOf(items),
  }, `total=${items.length}`);
}

/** アンケートの集計を返す */
export class GetCmsSurveyUseCase implements UseCase<CmsShopInput, CmsSurveyDto> {
  /**
   * 依存を受け取る。
   * @param deps マスタ・登録内容・時計・回答の保存先（無ければサンプルだけ）
   */
  constructor(private readonly deps: Pick<CmsDeps, 'spots' | 'cmsOverlay' | 'clock' | 'surveys'>) {}

  /**
   * お店のアンケートの集計を返す。
   * @param input 店舗のスポットID
   * @returns 成功: 集計。失敗: INVALID_INPUT / SPOT_NOT_FOUND / STORAGE_FAILED
   */
  async execute(input: CmsShopInput): Promise<Result<CmsSurveyDto>> {
    const log = logger.fn('execute', { spotId: input.spotId });
    const shop = findShop(this.deps.spots, input.spotId);
    if (!shop.ok) return log.fail(shop);
    const loaded = await loadOverlayAndToday(this.deps);
    if (!loaded.ok) return log.fail(loaded);
    const stored = this.deps.surveys === undefined ? ok<readonly SurveyResponse[]>([]) : await this.deps.surveys.list();
    if (!stored.ok) return log.fail(stored);
    const facts = shopFactsOf(this.deps.spots, shop.value, loaded.value.overlay);
    const samples = sampleSurveyResponses(facts, loaded.value.today);
    const real = stored.value.filter((r) => r.spotId === shop.value.id);
    return log.exit(ok(summarizeSurvey({ responses: [...samples, ...real], sampleCount: samples.length, today: loaded.value.today, hours: facts.hours })), `real=${real.length}`);
  }
}
