/**
 * @file 店舗CMS の来訪データユースケース（application/usecases/cms 層・読取系。フェーズ1はダミー＝docs/09 CMS-D08）
 * 本番は利用者アプリから送られた訪問記録（スポットID・日時・地区だけ＝D15）の集計を返す（フェーズ3）。
 * フェーズ1は「見せ方」を確かめるため、スポットID と今日から決まる固定のダミー値を返す（毎回同じ値＝発表で再現できる）。
 * 少数（CMS_SMALL_COUNT_THRESHOLD 未満）の値は秘匿して返す（docs/09 CMS-D05、PRV-04）。Math.random は使わない。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { epochDayOf } from '@/Common/utils/date';
import type { UseCase } from '@/application/AppServices';
import type { CmsCountDto, CmsShopInput, CmsVisitStatsDto } from '@/application/dto/CmsDto';
import { findShop } from '@/application/usecases/cms/cmsShopView';
import type { CmsDeps } from '@/application/usecases/cms/cmsShopView';
import { CMS_SMALL_COUNT_THRESHOLD, CMS_STATS_WEEKS } from '@/application/usecases/cms/constants';
import { WEEKDAY_LABELS } from '@/domain/spot/BusinessHours';
import type { Spot } from '@/domain/spot/Spot';

const logger = createLogger('application/usecases/cms/GetCmsVisitStatsUseCase');

/** 曜日ごとの来訪の重み（月〜日。週末が多い街歩きの傾向を模したもの） */
const WEEKDAY_WEIGHTS = [0.8, 0.7, 0.8, 0.9, 1.1, 1.7, 1.6] as const;

/** 時間帯の名前と重み */
const TIME_BANDS = [
  { label: '朝（〜10時）', weight: 0.6 },
  { label: '昼（11〜13時）', weight: 1.4 },
  { label: '午後（14〜16時）', weight: 1.2 },
  { label: '夕方（17〜19時）', weight: 0.9 },
  { label: '夜（20時〜）', weight: 0.3 },
] as const;

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
 * ダミーの来訪データを作る（スポットと今日だけで決まる）。
 * @param shop 店舗
 * @param today 今日（'YYYY-MM-DD'）
 * @returns 来訪データ
 */
export function dummyVisitStats(shop: Spot, today: string): CmsVisitStatsDto {
  const log = logger.fn('dummyVisitStats', { spotId: shop.id, today });
  const next = pseudoRandom(seedOf(`${shop.id}:${today}`));
  const dailyBase = (shop.partner ? 9 : 5) * (0.7 + next() * 0.6);
  const weekly = Array.from({ length: CMS_STATS_WEEKS }, (_, i) => countDto(`${CMS_STATS_WEEKS - 1 - i}週前`, dailyBase * 7 * (0.75 + next() * 0.5 + i * 0.03)));
  const weekdayTotal = WEEKDAY_WEIGHTS.reduce((a, b) => a + b, 0);
  const visits30 = dailyBase * 30;
  return log.exit({
    isDummy: true,
    today,
    visits30d: countDto('直近30日の訪問', visits30),
    visitors30d: countDto('直近30日に訪れた人', visits30 * (0.62 + next() * 0.1)),
    revisitRatePct: Math.round(22 + next() * 20),
    firstTimerPct: Math.round(35 + next() * 25),
    weekly: weekly.map((w, i) => (i === CMS_STATS_WEEKS - 1 ? { ...w, label: '今週' } : w)),
    byWeekday: WEEKDAY_LABELS.map((label, i) => countDto(label, (visits30 * (WEEKDAY_WEIGHTS[i] ?? 1)) / weekdayTotal)),
    byTimeBand: TIME_BANDS.map((band) => countDto(band.label, (visits30 * band.weight) / 4.4)),
    effects: [
      countDto('図鑑で見つけて来た人', visits30 * (0.18 + next() * 0.1)),
      countDto('クーポンを使った人', shop.partner ? visits30 * (0.05 + next() * 0.08) : 0),
      countDto('しばらくぶりに来た人', visits30 * next() * 0.12),
    ],
  });
}

/** 来訪データを返す（フェーズ1はダミー） */
export class GetCmsVisitStatsUseCase implements UseCase<CmsShopInput, CmsVisitStatsDto> {
  /**
   * 依存を受け取る。
   * @param deps マスタ・時計
   */
  constructor(private readonly deps: Pick<CmsDeps, 'spots' | 'clock'>) {}

  /**
   * 来訪データを返す。
   * @param input 店舗のスポットID
   * @returns 成功: 来訪データ（isDummy=true）。失敗: INVALID_INPUT / SPOT_NOT_FOUND
   */
  async execute(input: CmsShopInput): Promise<Result<CmsVisitStatsDto>> {
    const log = logger.fn('execute', { spotId: input.spotId });
    const shop = findShop(this.deps.spots, input.spotId);
    if (!shop.ok) return log.fail(shop);
    const today = this.deps.clock.today();
    log.debug('ダミーの集計を作ります', { epochDay: epochDayOf(today) });
    return log.exit(ok(dummyVisitStats(shop.value, today)));
  }
}
