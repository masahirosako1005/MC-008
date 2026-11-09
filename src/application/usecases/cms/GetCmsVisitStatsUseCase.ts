/**
 * @file 店舗CMS の来店データユースケース（application/usecases/cms 層・読取系。フェーズ1はダミー＝docs/09 CMS-D08）
 * 本番は利用者アプリから送られた訪問記録（スポットID・日時・地区だけ＝D15）の集計を返す（フェーズ3）。
 * フェーズ1は「見せ方」を確かめるため、スポットID と今日から決まる固定のダミー値を返す（毎回同じ値＝発表で再現できる）。
 * ダミーでも店の事実と食い違わないようにする（食い違うと数字全体が信用されない）：
 * - 定休日の曜日は 0 にして「定休日」と示し、営業時間にかからない時間帯は出さない（CMS で直した営業時間を使う）
 * - クーポンを一度も出していない店は、クーポンの効果を「まだ出していません」と示す
 * - 曜日別・時間帯別の合計は来店数と同じにする（最大剰余法で整数に分ける。合わないと数字全体が信用されない）
 * 少数（CMS_SMALL_COUNT_THRESHOLD 未満）の値は秘匿して返す（docs/09 CMS-D05、PRV-04）。Math.random は使わない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { CmsCountDto, CmsShopInput, CmsVisitStatsDto } from '@/application/dto/CmsDto';
import type { CmsOverlayData } from '@/application/ports/CmsOverlayRepository';
import { editOf, findShop, loadOverlayAndToday, mergeSpotEdit } from '@/application/usecases/cms/cmsShopView';
import type { CmsDeps } from '@/application/usecases/cms/cmsShopView';
import { CMS_SMALL_COUNT_THRESHOLD, CMS_STATS_WEEKS } from '@/application/usecases/cms/constants';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import { minutesOf, parseBusinessHoursText, WEEKDAY_LABELS } from '@/domain/spot/BusinessHours';
import type { BusinessHours } from '@/domain/spot/BusinessHours';
import type { Spot } from '@/domain/spot/Spot';

const logger = createLogger('application/usecases/cms/GetCmsVisitStatsUseCase');

/** 曜日ごとの来店の重み（月〜日。週末が多い街歩きの傾向を模したもの） */
const WEEKDAY_WEIGHTS = [0.8, 0.7, 0.8, 0.9, 1.1, 1.7, 1.6] as const;

/** 時間帯の名前・範囲（0時からの分、[from, to)）・重み */
const TIME_BANDS = [
  { label: '朝（〜11時）', from: 0, to: 660, weight: 0.6 },
  { label: '昼（11〜14時）', from: 660, to: 840, weight: 1.4 },
  { label: '午後（14〜17時）', from: 840, to: 1020, weight: 1.2 },
  { label: '夕方（17〜20時）', from: 1020, to: 1200, weight: 0.9 },
  { label: '夜（20時〜）', from: 1200, to: 1440, weight: 0.3 },
] as const;

/** ダミーを作るときの店の事実 */
export interface ShopFacts {
  readonly shop: Spot;
  /** 営業時間（書式が読めないときは undefined＝全曜日・全時間帯を出す） */
  readonly hours: BusinessHours | undefined;
  /** クーポンを出したことがあるか（マスタ＋CMS） */
  readonly hasCoupon: boolean;
}

/**
 * 文字列から 32bit の種を作る（FNV-1a）。
 * @param text 種の元
 * @returns 32bit 符号なし整数
 */
export function seedOf(text: string): number {
  const log = logger.fn('seedOf', { text });
  let hash = 0x811c9dc5;
  for (const ch of text) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return log.exit(hash);
}

/**
 * 種から 0〜1 の擬似乱数列を作る（mulberry32。同じ種なら同じ列）。
 * @param seed 32bit の種
 * @returns 呼ぶたびに次の値を返す関数
 */
export function pseudoRandom(seed: number): () => number {
  const log = logger.fn('pseudoRandom', { seed });
  let state = seed >>> 0;
  return log.exit(() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

/**
 * 集計の1項目を作る（少数は秘匿）。
 * @param label 名前
 * @param value 人数・回数
 * @returns 項目
 */
export function countDto(label: string, value: number): CmsCountDto {
  const log = logger.fn('countDto', { label });
  const rounded = Math.max(0, Math.round(value));
  return log.exit(rounded < CMS_SMALL_COUNT_THRESHOLD ? { label, suppressed: true } : { label, value: rounded, suppressed: false });
}

/**
 * 合計を重みで整数に分ける（最大剰余法：切り捨てて残った数を、小数部の大きい順に1ずつ配る。合計は total と同じ）。
 * @param total 分ける合計（0 以上の整数）
 * @param weights 重み（0 の項目には配らない）
 * @returns 重みと同じ並びの整数（重みの合計が 0 なら全部 0）
 */
export function apportion(total: number, weights: readonly number[]): readonly number[] {
  const log = logger.fn('apportion', { total, count: weights.length });
  const sum = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (sum <= 0 || total <= 0) return log.exit(weights.map(() => 0));
  const exact = weights.map((w) => (total * Math.max(0, w)) / sum);
  const counts = exact.map((x) => Math.floor(x));
  const rest = total - counts.reduce((acc, n) => acc + n, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order.slice(0, rest)) counts[i] = (counts[i] ?? 0) + 1;
  return log.exit(counts);
}

/**
 * 曜日別の来店（定休日は「定休日」、残りの曜日に重みで配る。合計は来店数と同じ）。
 * @param total 30日の来店数（整数）
 * @param hours 営業時間
 * @returns 月〜日の項目
 */
function weekdayCounts(total: number, hours: BusinessHours | undefined): readonly CmsCountDto[] {
  const log = logger.fn('weekdayCounts', { closed: hours?.closedDays.length ?? 0 });
  const closed = new Set(hours?.closedDays ?? []);
  const counts = apportion(total, WEEKDAY_WEIGHTS.map((w, i) => (closed.has(i) ? 0 : w)));
  return log.exit(WEEKDAY_LABELS.map((label, i): CmsCountDto => (closed.has(i)
    ? { label, suppressed: false, note: '定休日' }
    : countDto(label, counts[i] ?? 0))));
}

/**
 * 時間帯別の来店（営業時間にかからない時間帯は出さない。合計は来店数と同じ）。
 * @param total 30日の来店数（整数）
 * @param hours 営業時間
 * @returns 時間帯の項目
 */
function timeBandCounts(total: number, hours: BusinessHours | undefined): readonly CmsCountDto[] {
  const log = logger.fn('timeBandCounts', { open: hours?.open, close: hours?.close });
  const open = hours === undefined ? 0 : minutesOf(hours.open) ?? 0;
  const close = hours === undefined ? 1440 : minutesOf(hours.close) ?? 1440;
  const bands = TIME_BANDS.filter((b) => b.from < close && b.to > open);
  const counts = apportion(total, bands.map((b) => b.weight));
  return log.exit(bands.map((b, i) => countDto(b.label, counts[i] ?? 0)));
}

/**
 * ダミーの来店データを作る（店の事実と今日だけで決まる）。
 * @param facts 店・営業時間・クーポンを出したことがあるか
 * @param today 今日（'YYYY-MM-DD'）
 * @returns 来店データ
 */
export function dummyVisitStats(facts: ShopFacts, today: string): CmsVisitStatsDto {
  const log = logger.fn('dummyVisitStats', { spotId: facts.shop.id, today });
  const next = pseudoRandom(seedOf(`${facts.shop.id}:${today}`));
  const dailyBase = (facts.shop.partner ? 9 : 5) * (0.7 + next() * 0.6);
  const weekly = Array.from({ length: CMS_STATS_WEEKS }, (_, i) => countDto(i === CMS_STATS_WEEKS - 1 ? '直近7日' : `${CMS_STATS_WEEKS - 1 - i}週前`, dailyBase * 7 * (0.75 + next() * 0.5 + i * 0.03)));
  const visits30 = dailyBase * 30;
  const total = Math.max(0, Math.round(visits30));
  return log.exit({
    isDummy: true,
    today,
    visits30d: countDto('直近30日の来店', total),
    visitors30d: countDto('直近30日に来た人', visits30 * (0.62 + next() * 0.1)),
    revisitRatePct: Math.round(22 + next() * 20),
    firstTimerPct: Math.round(35 + next() * 25),
    weekly,
    byWeekday: weekdayCounts(total, facts.hours),
    byTimeBand: timeBandCounts(total, facts.hours),
    effects: [
      countDto('近くを通ってアプリで知った人', visits30 * (0.18 + next() * 0.1)),
      facts.hasCoupon ? countDto('クーポンを使った人', visits30 * (0.05 + next() * 0.08)) : { label: 'クーポンを使った人', suppressed: false, note: 'まだ出していません' },
      countDto('しばらくぶりに来た人', visits30 * next() * 0.12),
    ],
  });
}

/**
 * 店の事実（CMS で直した営業時間・クーポンを出したことがあるか）を集める。
 * @param spots マスタ
 * @param shop 店（マスタの値）
 * @param overlay 登録内容
 * @returns 店の事実
 */
export function shopFactsOf(spots: SpotRepository, shop: Spot, overlay: CmsOverlayData): ShopFacts {
  const log = logger.fn('shopFactsOf', { spotId: shop.id });
  const merged = mergeSpotEdit(shop, editOf(overlay, shop.id));
  const hasCoupon = spots.shopEventsForSpot(shop.id).some((e) => e.kind === 'coupon') || overlay.shopEvents.some((r) => r.spotId === shop.id && r.kind === 'coupon');
  return log.exit({ shop: merged, hours: parseBusinessHoursText(merged.hours), hasCoupon });
}

/** 来店データを返す（フェーズ1はダミー） */
export class GetCmsVisitStatsUseCase implements UseCase<CmsShopInput, CmsVisitStatsDto> {
  /**
   * 依存を受け取る。
   * @param deps マスタ・登録内容・時計
   */
  constructor(private readonly deps: Pick<CmsDeps, 'spots' | 'cmsOverlay' | 'clock'>) {}

  /**
   * 来店データを返す。
   * @param input 店舗のスポットID
   * @returns 成功: 来店データ（isDummy=true）。失敗: INVALID_INPUT / SPOT_NOT_FOUND / STORAGE_FAILED
   */
  async execute(input: CmsShopInput): Promise<Result<CmsVisitStatsDto>> {
    const log = logger.fn('execute', { spotId: input.spotId });
    const shop = findShop(this.deps.spots, input.spotId);
    if (!shop.ok) return log.fail(shop);
    const loaded = await loadOverlayAndToday(this.deps);
    if (!loaded.ok) return log.fail(loaded);
    const facts = shopFactsOf(this.deps.spots, shop.value, loaded.value.overlay);
    return log.exit(ok(dummyVisitStats(facts, loaded.value.today)));
  }
}
