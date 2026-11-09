/**
 * @file 図鑑の表示文言を決める純粋関数（presentation/screens/Zukan 層）
 * タイルの名前・補足・読み上げ名・なじみ度の星・季節の印、ヘッダーの数字を DOM と切り離して決め、テストできるようにする。
 * 達成率（％や「全n件中m件」）は作らない（CLAUDE.md 6.5）。
 */
import type { SeasonDto, SpotKindDto, ZukanDistrictDto, ZukanTileDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { UNKNOWN_SPOT_NAME } from '@/Common/ui/cards/SpotCard';
import { KIND_LABELS, LEVEL_DESCRIPTIONS } from '@/presentation/shared/labels';

const logger = createLogger('presentation/screens/Zukan/zukanModel');

/** 未発見タイルをタップしたときの案内（位置は教えない＝B） */
export const UNKNOWN_TILE_HINT = '80m以内に近づくと見つかります';

/** 図鑑の下に出す一言（通いを主役にする） */
export const ZUKAN_FOOTNOTE = '通うほどカードが育つ。全部そろえなくても街は育つ。';

/** なじみ度の最高段階（星の数） */
export const MAX_FAMILIARITY = 3;

/** 季節の印（春→冬） */
export const SEASON_MARKS: readonly { readonly season: SeasonDto; readonly label: string }[] = [
  { season: 'spring', label: '春' },
  { season: 'summer', label: '夏' },
  { season: 'autumn', label: '秋' },
  { season: 'winter', label: '冬' },
];

/** 図鑑の区分（名所→店舗の順に見出しを出す） */
export const ZUKAN_SECTIONS: readonly { readonly kind: SpotKindDto; readonly title: string }[] = [
  { kind: 'landmark', title: '名所' },
  { kind: 'shop', title: '店舗' },
];

/** 季節の印1つ分 */
export interface SeasonMark {
  readonly label: string;
  readonly visited: boolean;
}

/**
 * タイルに出す名前（未発見は「？？？」）。
 * @param tile タイル
 * @returns 名前
 */
export function tileName(tile: ZukanTileDto): string {
  const log = logger.fn('tileName', { status: tile.status });
  return log.exit(tile.status === 'unknown' || tile.name === undefined ? UNKNOWN_SPOT_NAME : tile.name);
}

/**
 * タイルの補足。訪問済みは次のなじみ度まで（最高段階なら呼び名）、発見済みは「まだ行っていない」、未発見は「未発見」。
 * 未発見の見つけ方はカードごとに繰り返さず、格子の上に1回だけ出す（SpotGrid の UNKNOWN_TILE_HINT）。
 * @param tile タイル
 * @returns 補足の文言
 */
export function tileCaption(tile: ZukanTileDto): string {
  const log = logger.fn('tileCaption', { status: tile.status, visitCount: tile.visitCount });
  if (tile.status === 'visited') return log.exit(tile.nextFamiliarityText ?? `${tile.familiarityLabel ?? '常連'}になりました`);
  if (tile.status === 'discovered') return log.exit('まだ行っていない');
  return log.exit('未発見');
}

/**
 * なじみ度の星（'★★☆'）。訪問済み以外は空文字。
 * @param tile タイル
 * @returns 星の文字列
 */
export function familiarityStars(tile: ZukanTileDto): string {
  const log = logger.fn('familiarityStars', { familiarity: tile.familiarity });
  if (tile.status !== 'visited' || tile.familiarity === undefined) return log.exit('');
  return log.exit('★'.repeat(tile.familiarity) + '☆'.repeat(MAX_FAMILIARITY - tile.familiarity));
}

/**
 * 季節の印（春夏秋冬の4つ。訪れた季節は visited=true）。
 * @param tile タイル
 * @returns 印の配列（春→冬）
 */
export function seasonMarks(tile: ZukanTileDto): SeasonMark[] {
  const log = logger.fn('seasonMarks', { seasons: tile.seasons });
  const visited = new Set(tile.seasons ?? []);
  return log.exit(SEASON_MARKS.map((mark) => ({ label: mark.label, visited: visited.has(mark.season) })));
}

/**
 * タイルの読み上げ名（色に頼らず状態を言葉で伝える）。未発見は種別も伏せる。
 * @param tile タイル
 * @returns 'N西城跡（名所）なじみ、通った 3回、訪れた季節 秋・冬' など
 */
export function tileAriaLabel(tile: ZukanTileDto): string {
  const log = logger.fn('tileAriaLabel', { status: tile.status });
  if (tile.status === 'unknown') return log.exit(`未発見のスポット。${UNKNOWN_TILE_HINT}`);
  const head = `${tileName(tile)}（${KIND_LABELS[tile.kind]}）`;
  if (tile.status === 'discovered') return log.exit(`${head}発見済み、まだ行っていない`);
  const seasons = seasonMarks(tile).filter((m) => m.visited).map((m) => m.label).join('・');
  const next = tile.nextFamiliarityText === undefined ? '' : `、${tile.nextFamiliarityText}`;
  return log.exit(`${head}${tile.familiarityLabel ?? '訪問'}、通った ${tile.visitCount}回、訪れた季節 ${seasons}${next}`);
}

/**
 * 最終訪問日を年なしの短い表示にする（'2026/11/04（水）' → '11/04（水）'）。
 * @param district 選んでいる地区
 * @returns 短い日付。未訪問なら '—'
 */
export function shortLastVisit(district: ZukanDistrictDto): string {
  const log = logger.fn('shortLastVisit', { hasLastVisit: district.lastVisitLabel !== undefined });
  const label = district.lastVisitLabel;
  if (label === undefined) return log.exit('—');
  return log.exit(label.replace(/^\d{4}\//, ''));
}

/**
 * 成長段階の説明（'建物が増える' など）。
 * @param level 成長段階 0..3
 * @returns 説明
 */
export function levelDescription(level: number): string {
  const log = logger.fn('levelDescription', { level });
  const lv = Math.min(LEVEL_DESCRIPTIONS.length - 1, Math.max(0, Math.round(level)));
  return log.exit(LEVEL_DESCRIPTIONS[lv] ?? '');
}

/**
 * タイルを区分（名所・店舗）ごとに分ける。順番は保つ。
 * @param tiles タイル（DTO の順）
 * @returns 区分ごとのタイル（空の区分は含めない）
 */
export function groupTiles(tiles: readonly ZukanTileDto[]): { readonly title: string; readonly tiles: readonly ZukanTileDto[] }[] {
  const log = logger.fn('groupTiles', { count: tiles.length });
  const groups = ZUKAN_SECTIONS.map((section) => ({ title: section.title, tiles: tiles.filter((t) => t.kind === section.kind) })).filter((g) => g.tiles.length > 0);
  return log.exit(groups);
}
