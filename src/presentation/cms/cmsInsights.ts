/**
 * @file 来店データの要点（presentation/cms 層）
 * いちばん来店の多い曜日と時間帯を1行（24字以内・句点なし・括弧なし）にする。秘匿した項目（少数）・定休日は比べない（PRV-04）。
 */
import type { CmsCountDto, CmsVisitStatsDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/cms/cmsInsights');

/** 時間帯の名前から、要点の行とグラフの軸に出す範囲への表（括弧書きをなくす。表に無い名前はそのまま出す） */
export const BAND_RANGES: Readonly<Record<string, string>> = {
  '朝（〜11時）': '11時まで', '昼（11〜14時）': '11〜14時', '午後（14〜17時）': '14〜17時', '夕方（17〜20時）': '17〜20時', '夜（20時〜）': '20時以降',
};

/** 要点 */
export interface KeyPoint {
  /** 例「土曜の11〜14時が最も多い」 */
  readonly text: string;
  /** いちばん多い曜日（'土' など） */
  readonly weekday: string;
}

/**
 * 秘匿していない項目のうち最大のものを返す。
 * @param counts 項目
 * @returns 最大の項目（無ければ undefined）
 */
export function largest(counts: readonly CmsCountDto[]): CmsCountDto | undefined {
  const log = logger.fn('largest', { count: counts.length });
  const visible = counts.filter((c) => !c.suppressed && c.note === undefined && c.value !== undefined);
  return log.exit(visible.reduce<CmsCountDto | undefined>((best, c) => ((c.value ?? 0) > (best?.value ?? -1) ? c : best), undefined));
}

/**
 * 来店データの要点（いちばん多い曜日と時間帯）を作る。
 * @param stats 来店データ
 * @returns 要点（作れなければ undefined）
 */
export function keyPointOf(stats: CmsVisitStatsDto): KeyPoint | undefined {
  const log = logger.fn('keyPointOf', { today: stats.today });
  const day = largest(stats.byWeekday);
  if (day === undefined) return log.exit(undefined);
  const band = largest(stats.byTimeBand);
  return log.exit({ text: band === undefined ? `${day.label}曜が最も多い` : `${day.label}曜の${BAND_RANGES[band.label] ?? band.label}が最も多い`, weekday: day.label });
}
