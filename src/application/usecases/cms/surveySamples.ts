/**
 * @file アンケートのサンプル回答（application/usecases/cms 層。docs/09 CMS-V06）
 * 回答がまだ集まっていなくても「見せ方」と「まとめ」を確かめられるよう、お店ごとに決まったサンプルを作る（来店データのダミーと同じ考え方）。
 * 種はスポットID だけ。日付は今日からさかのぼって置くので、同じ日なら何度開いても同じ値になる（発表で再現できる）。Math.random は使わない。
 * お店の事実と食い違わないようにする：定休日・今日には置かず、営業時間にかからない時間帯には置かない。
 * お店ごとに「弱い曜日」と「目立つ気になる点」を1つずつ持たせ、まとめ（改善ポイント・打ち時）に違いが出るようにする。数値はすべて（仮）。
 */
import { createLogger } from '@/Common/logging/logger';
import { addDays, dayOfWeekOf, jstInstantOf } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { pseudoRandom, seedOf, TIME_BANDS, WEEKDAY_WEIGHTS } from '@/application/usecases/cms/GetCmsVisitStatsUseCase';
import type { ShopFacts } from '@/application/usecases/cms/GetCmsVisitStatsUseCase';
import { SURVEY_CONCERNS, SURVEY_GOODS, SURVEY_TRIGGERS } from '@/application/usecases/survey/shopSurvey';
import type { SurveyResponse } from '@/application/usecases/survey/shopSurvey';
import { minutesOf } from '@/domain/spot/BusinessHours';

const logger = createLogger('application/usecases/cms/surveySamples');

/** サンプルの回答数の下限と幅（協力店は少し多い） */
const SAMPLE_BASE = 30;
const SAMPLE_SPREAD = 16;
const SAMPLE_PARTNER_BONUS = 10;
/** さかのぼる週の数（4週＝28日。集計期間の30日に収まる） */
const SAMPLE_WEEKS = 4;

/** 満足度（5〜1）のふだんの重み */
const SATISFACTION_WEIGHTS = [0.36, 0.36, 0.17, 0.08, 0.03] as const;
/** よかったところを選ぶ確率（SURVEY_GOODS の並び） */
const GOOD_RATES = [0.62, 0.42, 0.36, 0.2, 0.22] as const;
/** きっかけの重み（SURVEY_TRIGGERS の並び：アプリ・通りがかり・クーポン・いつも・すすめ） */
const TRIGGER_WEIGHTS = [0.3, 0.26, 0.04, 0.26, 0.14] as const;
/** クーポンを出している店の「クーポン・イベント」の重み */
const TRIGGER_COUPON_WEIGHT = 0.24;

/** 気になったところごとのひとこと */
const CONCERN_COMMENTS: Readonly<Record<string, string>> = {
  wait: 'お昼どきは少し待ちました',
  price: 'もう少し手ごろだとうれしいです',
  entry: '入口が少しわかりにくかったです',
  info: '品書きが先にわかると助かります',
  lineup: '季節の品がもっとあるとうれしいです',
  hours: '夕方も開いているとうれしいです',
};
/** 満足した人のひとこと */
const GOOD_COMMENTS = ['店員さんが親切でした', '落ち着く雰囲気で、また来たいです', 'アプリで見つけて初めて来ました', '子ども連れでも入りやすかったです', '近くに来たらまた寄ります'] as const;

/**
 * 重みで1つ選ぶ。
 * @param weights 重み（0 の項目は選ばない）
 * @param r 0〜1 の乱数
 * @returns 選んだ位置（重みの合計が 0 なら 0）
 */
export function pickIndex(weights: readonly number[], r: number): number { // audit-ignore: fnlog-missing 回答ごとに何度も呼ぶ小さな計算（sampleSurveyResponses で記録する）
  const sum = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  let rest = r * sum;
  for (let i = 0; i < weights.length; i += 1) {
    rest -= Math.max(0, weights[i] ?? 0);
    if (rest < 0) return i;
  }
  return Math.max(0, weights.map((w) => w > 0).lastIndexOf(true));
}

/**
 * 今日からさかのぼって、指定した曜日のいちばん近い日を返す。
 * @param today 今日
 * @param weekday 曜日（0=月 … 6=日）
 * @returns その曜日の日（今日がその曜日なら今日）
 */
function lastDateOfWeekday(today: LocalDate, weekday: number): LocalDate { // audit-ignore: fnlog-missing 回答ごとに呼ぶ小さな日付計算
  const todayIndex = (dayOfWeekOf(today) + 6) % 7;
  return addDays(today, -((todayIndex - weekday + 7) % 7));
}

/** お店の持ち味（サンプルに違いを出すための設定） */
interface ShopCharacter {
  /** 開いている曜日の重み（月〜日） */
  readonly weekdayWeights: readonly number[];
  /** 開いている時間帯（TIME_BANDS の位置） */
  readonly bands: readonly number[];
  /** 弱い曜日（0=月 … 6=日） */
  readonly weakWeekday: number;
  /** 目立つ気になる点（SURVEY_CONCERNS の位置） */
  readonly mainConcern: number;
  /** その次に多い気になる点 */
  readonly subConcern: number;
  /** 直近2週の満足度が下がり気味か */
  readonly declining: boolean;
}

/**
 * お店の持ち味を決める（種と営業時間から）。
 * @param facts お店の事実
 * @param next 乱数
 * @returns 持ち味
 */
function characterOf(facts: ShopFacts, next: () => number): ShopCharacter {
  const log = logger.fn('characterOf', { spotId: facts.shop.id });
  const closed = new Set(facts.hours?.closedDays ?? []);
  const weekdayWeights = WEEKDAY_WEIGHTS.map((w, i) => (closed.has(i) ? 0 : w));
  const open = facts.hours === undefined ? 0 : minutesOf(facts.hours.open) ?? 0;
  const close = facts.hours === undefined ? 1440 : minutesOf(facts.hours.close) ?? 1440;
  const bands = TIME_BANDS.map((b, i) => (b.from < close && b.to > open ? i : -1)).filter((i) => i >= 0);
  // 弱い曜日は、開いている日のうち来店の多い土・日・金のどれか
  const busy = [5, 6, 4].filter((d) => !closed.has(d));
  const weakWeekday = busy[Math.floor(next() * busy.length)] ?? weekdayWeights.findIndex((w) => w > 0);
  const mainConcern = Math.floor(next() * SURVEY_CONCERNS.length);
  const subConcern = (mainConcern + 1 + Math.floor(next() * (SURVEY_CONCERNS.length - 1))) % SURVEY_CONCERNS.length;
  return log.exit({ weekdayWeights, bands, weakWeekday, mainConcern, subConcern, declining: next() < 0.4 });
}

/**
 * サンプルの回答を1件作る。
 * @param facts お店の事実
 * @param character お店の持ち味
 * @param today 今日
 * @param index 何件目か
 * @param next 乱数
 * @returns 回答
 */
function sampleResponse(facts: ShopFacts, character: ShopCharacter, today: LocalDate, index: number, next: () => number): SurveyResponse { // audit-ignore: fnlog-missing 1件ごとに呼ぶ組み立て（sampleSurveyResponses で記録する）
  const weekday = pickIndex(character.weekdayWeights, next());
  const week = Math.floor(next() * SAMPLE_WEEKS);
  // 今日には置かない（今の時刻より先の回答ができてしまうため。今日と同じ曜日は1週前から）
  const latest = lastDateOfWeekday(today, weekday);
  const date = addDays(latest, -7 * (week + (latest === today ? 1 : 0)));
  const bandIndex = character.bands[pickIndex(character.bands.map((i) => TIME_BANDS[i]?.weight ?? 0), next())] ?? 1;
  const band = TIME_BANDS[bandIndex] ?? TIME_BANDS[1];
  const open = facts.hours === undefined ? 0 : minutesOf(facts.hours.open) ?? 0;
  const close = facts.hours === undefined ? 1439 : (minutesOf(facts.hours.close) ?? 1440) - 1;
  const minute = Math.min(Math.max(Math.floor(band.from + next() * (band.to - band.from)), open, 420), Math.max(close, 420), 1320);
  const weak = weekday === character.weakWeekday;
  const dipped = (weak && next() < 0.7) || (character.declining && week < 2 && next() < 0.35);
  const satisfaction = Math.max(1, 5 - pickIndex(SATISFACTION_WEIGHTS, next()) - (dipped ? 1 : 0));
  const concerns = SURVEY_CONCERNS.filter((_, i) => next() < (i === character.mainConcern ? (weak ? 0.8 : 0.24) : i === character.subConcern ? 0.16 : 0.04)).map((c) => c.key);
  const goods = SURVEY_GOODS.filter((_, i) => next() < (GOOD_RATES[i] ?? 0.2) * (satisfaction <= 2 ? 0.4 : 1)).map((c) => c.key);
  const trigger = SURVEY_TRIGGERS[pickIndex(TRIGGER_WEIGHTS.map((w, i) => (i === 2 && facts.hasCoupon ? TRIGGER_COUPON_WEIGHT : w)), next())]?.key ?? 'passing';
  const r = next();
  const revisit = satisfaction >= 4 ? (r < 0.84 ? 'yes' : 'maybe') : satisfaction === 3 ? (r < 0.4 ? 'yes' : r < 0.85 ? 'maybe' : 'unsure') : r < 0.1 ? 'yes' : r < 0.5 ? 'maybe' : 'unsure';
  const firstConcern = concerns[0];
  const speaks = next() < 0.3;
  const pick = next();
  const comment = !speaks ? undefined : firstConcern !== undefined && satisfaction <= 4 ? CONCERN_COMMENTS[firstConcern] : satisfaction >= 4 ? GOOD_COMMENTS[Math.floor(pick * GOOD_COMMENTS.length)] : undefined;
  return Object.freeze({
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    spotId: facts.shop.id,
    answeredAt: jstInstantOf(date, Math.floor(minute / 60), minute % 60),
    satisfaction, trigger, goods, concerns, revisit,
    ...(comment === undefined ? {} : { comment }),
  });
}

/**
 * お店のサンプルの回答を作る（スポットID と今日だけで決まる）。
 * @param facts お店・営業時間・クーポンを出したことがあるか
 * @param today 今日
 * @returns 回答の一覧（開いている曜日が無ければ空）
 */
export function sampleSurveyResponses(facts: ShopFacts, today: LocalDate): readonly SurveyResponse[] {
  const log = logger.fn('sampleSurveyResponses', { spotId: facts.shop.id, today });
  const next = pseudoRandom(seedOf(`survey:${facts.shop.id}`));
  const character = characterOf(facts, next);
  if (character.bands.length === 0 || character.weekdayWeights.every((w) => w === 0)) return log.exit([], 'closed');
  const count = SAMPLE_BASE + Math.floor(next() * SAMPLE_SPREAD) + (facts.shop.partner ? SAMPLE_PARTNER_BONUS : 0);
  return log.exit(Array.from({ length: count }, (_, i) => sampleResponse(facts, character, today, i, next)), `count=${count}`);
}
