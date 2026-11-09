/**
 * @file 来店データの「ひとことで言うと」（presentation/cms 層）
 * グラフを読み慣れていない店主でも要点がつかめるように、集計から短い文を作る（docs/09 CMS-D02・D03）。
 * 秘匿した項目（少数）は比較に使わない（PRV-04）。断定を避け、ヒントは「〜かもしれません」とする。
 */
import type { CmsCountDto, CmsVisitStatsDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/cms/cmsInsights');

/** 平日（月〜金）の曜日ラベル */
const WEEKDAYS = new Set(['月', '火', '水', '木', '金']);

/** 時間帯ラベルの括弧より前（例 '昼（11〜13時）' → '昼'） */
const BAND_HEAD = /^([^（]+)/;

/**
 * 秘匿していない項目のうち最大のものを返す。
 * @param counts 項目
 * @returns 最大の項目（無ければ undefined）
 */
export function largest(counts: readonly CmsCountDto[]): CmsCountDto | undefined {
  const log = logger.fn('largest', { count: counts.length });
  const visible = counts.filter((c) => !c.suppressed && c.value !== undefined);
  return log.exit(visible.reduce<CmsCountDto | undefined>((best, c) => ((c.value ?? 0) > (best?.value ?? -1) ? c : best), undefined));
}

/**
 * 曜日の要点（いちばん多い曜日と、平日の平均との比）。
 * @param byWeekday 曜日別（月〜日）
 * @returns 文（作れなければ undefined）
 */
function weekdayInsight(byWeekday: readonly CmsCountDto[]): string | undefined {
  const log = logger.fn('weekdayInsight');
  const top = largest(byWeekday);
  const weekdays = byWeekday.filter((c) => WEEKDAYS.has(c.label) && c.value !== undefined);
  if (top === undefined || weekdays.length === 0) return log.exit(undefined);
  const average = weekdays.reduce((sum, c) => sum + (c.value ?? 0), 0) / weekdays.length;
  const ratio = average > 0 ? (top.value ?? 0) / average : 0;
  const compare = WEEKDAYS.has(top.label) || ratio < 1.2 ? '' : `。平日の平均の約${ratio.toFixed(1)}倍です`;
  return log.exit(`いちばん多いのは${top.label}曜日${compare}。`);
}

/**
 * 週の変化の要点（今週と先週の比較）。
 * @param weekly 週ごと（古い週 → 今週）
 * @returns 文（作れなければ undefined）
 */
function weeklyInsight(weekly: readonly CmsCountDto[]): string | undefined {
  const log = logger.fn('weeklyInsight');
  const thisWeek = weekly.at(-1)?.value;
  const lastWeek = weekly.at(-2)?.value;
  if (thisWeek === undefined || lastWeek === undefined || lastWeek === 0) return log.exit(undefined);
  const change = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  if (Math.abs(change) < 5) return log.exit('今週は先週とほぼ同じです。');
  return log.exit(`今週は先週より${Math.abs(change)}%${change > 0 ? '多く' : '少なく'}なっています。`);
}

/**
 * 来店データから「ひとことで言うと」の文を作る（最大4つ）。
 * @param stats 来店データ
 * @returns 文の配列
 */
export function insightsOf(stats: CmsVisitStatsDto): readonly string[] {
  const log = logger.fn('insightsOf', { today: stats.today });
  const band = largest(stats.byTimeBand);
  const bandName = band === undefined ? undefined : (BAND_HEAD.exec(band.label)?.[1] ?? band.label);
  const top = largest(stats.byWeekday);
  const lines = [
    weekdayInsight(stats.byWeekday),
    band === undefined ? undefined : `時間帯では${band.label}がいちばん多いです。`,
    weeklyInsight(stats.weekly),
    top !== undefined && bandName !== undefined ? `ヒント：${top.label}曜日の${bandName}に向けたクーポンやイベントは、来店のきっかけになりやすいかもしれません。` : undefined,
  ];
  return log.exit(lines.filter((line): line is string => line !== undefined));
}
