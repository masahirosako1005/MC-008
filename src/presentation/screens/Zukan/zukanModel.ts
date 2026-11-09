/**
 * @file 図鑑の表示文言と絞り込みを決める純粋関数（presentation/screens/Zukan 層）
 * タイルの名前・補足・読み上げ名・なじみ度の星・季節の印、地区と状態の絞り込みを DOM と切り離して決め、テストできるようにする。
 * 達成率（％や「全n件中m件」）は作らない（CLAUDE.md 6.5）。
 */
import type { SeasonDto, SpotKindDto, SpotStatusDto, ZukanTileDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { UNKNOWN_SPOT_NAME } from '@/Common/ui/cards/SpotCard';
import { KIND_LABELS } from '@/presentation/shared/labels';

const logger = createLogger('presentation/screens/Zukan/zukanModel');

/** 未発見タイルの見つけ方（位置は教えない＝B） */
export const UNKNOWN_TILE_HINT = '80m以内に近づくと見つかります';

/** 状態の絞り込み（'all' はすべて） */
export type ZukanStatusFilter = 'all' | SpotStatusDto;

/** 図鑑の絞り込み（地区は undefined ですべての地区） */
export interface ZukanFilter {
  readonly districtId?: string;
  readonly status: ZukanStatusFilter;
}

/** 状態の絞り込みの選択肢（左から） */
export const STATUS_FILTERS: readonly { readonly value: ZukanStatusFilter; readonly label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'visited', label: '達成済み' },
  { value: 'discovered', label: '発見済み' },
  { value: 'unknown', label: '未発見' },
];

/** 絞り込みで1枚も残らなかったときの文言 */
export const EMPTY_FILTER_TEXT = 'この条件のカードはまだありません';

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
 * タイルに出す名前（2026-11-09「すべて表示」で未発見でも名前を出す。名前が無いときだけ「？？？」）。
 * @param tile タイル
 * @returns 名前
 */
export function tileName(tile: ZukanTileDto): string {
  const log = logger.fn('tileName', { status: tile.status });
  return log.exit(tile.name ?? UNKNOWN_SPOT_NAME);
}

/**
 * タイルの補足。訪問済みは次のなじみ度まで（最高段階なら呼び名）、発見済みは「まだ行っていない」、未発見は「未発見」。
 * 未発見の見つけ方はカードには出さず、拡大プレビューの「取得方法」と読み上げ名で伝える。
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
 * タイルの読み上げ名（色に頼らず状態を言葉で伝える）。
 * @param tile タイル
 * @returns 'N西城跡（名所）なじみ、通った 3回、訪れた季節 秋・冬' など
 */
export function tileAriaLabel(tile: ZukanTileDto): string {
  const log = logger.fn('tileAriaLabel', { status: tile.status });
  const head = `${tileName(tile)}（${KIND_LABELS[tile.kind]}）`;
  if (tile.status === 'unknown') return log.exit(`${head}未発見。${UNKNOWN_TILE_HINT}`);
  if (tile.status === 'discovered') return log.exit(`${head}発見済み、まだ行っていない`);
  const seasons = seasonMarks(tile).filter((m) => m.visited).map((m) => m.label).join('・');
  const next = tile.nextFamiliarityText === undefined ? '' : `、${tile.nextFamiliarityText}`;
  return log.exit(`${head}${tile.familiarityLabel ?? '訪問'}、通った ${tile.visitCount}回、訪れた季節 ${seasons}${next}`);
}

/**
 * 地区と状態でタイルを絞り込む。順番は保つ。
 * @param tiles タイル（DTO の順）
 * @param filter 絞り込み（地区 undefined ですべての地区、状態 'all' ですべての状態）
 * @returns 条件に合うタイル
 */
export function filterTiles(tiles: readonly ZukanTileDto[], filter: ZukanFilter): ZukanTileDto[] {
  const log = logger.fn('filterTiles', { count: tiles.length, districtId: filter.districtId, status: filter.status });
  const result = tiles.filter((t) => (filter.districtId === undefined || t.districtId === filter.districtId) && (filter.status === 'all' || t.status === filter.status));
  return log.exit(result);
}

/**
 * 地区の絞り込みの値を検証する（一覧に無い地区はすべての地区に戻す）。
 * @param districtId 絞り込みたい地区
 * @param districtIds 選べる地区の ID
 * @returns 一覧にあればその ID、無ければ undefined
 */
export function validDistrictFilter(districtId: string | undefined, districtIds: readonly string[]): string | undefined {
  const log = logger.fn('validDistrictFilter', { districtId });
  return log.exit(districtId !== undefined && districtIds.includes(districtId) ? districtId : undefined);
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
