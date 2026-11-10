/**
 * @file 地図の上の DOM 部品に使う線のアイコン（presentation/screens/Map/town 層）
 * 絞り込みのチップ・お店カードの便利情報と「行きたい」・好みパネルのチップに使う。Common/ui/icons と同じ 24×24 の線の絵（currentColor）。
 * UI のアイコンは線で1系統にそろえる（ドット絵は Canvas の街の中だけ。CLAUDE.md §14-11、2026-11-10 UI/UX 改善）。
 */
import { createLogger } from '@/Common/logging/logger';
import { createLineIcon, iconPathsOf } from '@/Common/ui/icons';

const logger = createLogger('presentation/screens/Map/town/mapLineIcons');

/** アイコンの名前（便利情報・絞り込み・好み） */
export type MapLineIconName =
  | 'today'
  | 'stroller'
  | 'toilet'
  | 'kids'
  | 'rainOk'
  | 'nursing'
  | 'parking'
  | 'heart'
  | 'pin'
  | 'cafe'
  | 'sweets'
  | 'bread'
  | 'meal'
  | 'drink'
  | 'shopping'
  | 'culture';

/** 円（中心 cx,cy・半径 r）の d 属性 */
const ring = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`;

/** 図形（d 属性の列。'*' 始まりは塗り） */
const PATHS: Readonly<Record<MapLineIconName, readonly string[]>> = {
  today: iconPathsOf('star'),
  // ベビーカー
  stroller: ['M4.5 11h13l-1.5 4a2 2 0 0 1-1.9 1.3H8.3A2 2 0 0 1 6.4 15z', 'M11 11V4.5a6.5 6.5 0 0 1 6.5 6.5', 'M17.5 11l1.8-4H21', ring(8.5, 19.5, 1.4), ring(14.5, 19.5, 1.4)],
  toilet: iconPathsOf('wc'),
  // 子どもの顔
  kids: [ring(12, 12, 8.5), `*${ring(9, 10.5, 1)}`, `*${ring(15, 10.5, 1)}`, 'M8.5 14.5a4 4 0 0 0 7 0'],
  // 傘
  rainOk: ['M3.5 12a8.5 8.5 0 0 1 17 0z', 'M12 12v6.5a2 2 0 0 0 4 0', 'M12 3.5V2.5'],
  // 哺乳びん
  nursing: ['M8.5 9.5h7v9.5a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z', 'M10 9.5V8a2 2 0 0 1 4 0v1.5', 'M12 6V3.5', 'M8.5 13.5h3', 'M8.5 16.5h3'],
  // 駐車場（P）
  parking: ['M6 3.5h12A2.5 2.5 0 0 1 20.5 6v12a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5z', 'M9.5 17V7.5h3.25a2.75 2.75 0 0 1 0 5.5H9.5'],
  // 行きたい（ハート）
  heart: ['M12 20.5s-7.5-4.6-7.5-10.2a4.3 4.3 0 0 1 7.5-2.9 4.3 4.3 0 0 1 7.5 2.9c0 5.6-7.5 10.2-7.5 10.2z'],
  pin: iconPathsOf('pin'),
  // カップと湯気
  cafe: ['M5 9.5h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z', 'M16 11h1.5a2.25 2.25 0 0 1 0 4.5h-1.7', 'M8.5 3.5v2.5', 'M12.5 3.5v2.5'],
  // 串だんご
  sweets: [ring(12, 5.25, 2.5), ring(12, 10.25, 2.5), ring(12, 15.25, 2.5), 'M12 17.75v3.75'],
  // 食パン
  bread: ['M5 11.2A3.4 3.4 0 0 1 7.6 5.5h8.8a3.4 3.4 0 0 1 2.6 5.7V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18z'],
  // どんぶりと箸
  meal: ['M3.5 11.5h17c0 4.7-3.8 8-8.5 8s-8.5-3.3-8.5-8z', 'M7.5 8.5l9.5-5', 'M11 8.5l8-3'],
  // グラス
  drink: ['M7 4.5h10l-1 6.5a4 4 0 0 1-8 0z', 'M12 15v4.5', 'M8.5 19.5h7'],
  // 買い物袋
  shopping: ['M5.5 8.5h13l-1 11h-11z', 'M9 8.5V7a3 3 0 0 1 6 0v1.5'],
  // 鳥居
  culture: ['M3.5 6.5c5.5 1.2 11.5 1.2 17 0', 'M5.5 11h13', 'M7.5 7.5v13', 'M16.5 7.5v13'],
};

/**
 * 線のアイコンの図形（d 属性の列）を返す。
 * @param name アイコンの名前
 * @returns d 属性の列
 */
export function mapLineIconPaths(name: MapLineIconName): readonly string[] {
  const log = logger.fn('mapLineIconPaths', { name });
  return log.exit(PATHS[name]);
}

/**
 * 線のアイコンの svg 要素を作る（大きさは CSS で決める。装飾なので読み上げない）。
 * @param name アイコンの名前
 * @param className 付けるクラス（.icon に加えて）
 * @returns svg 要素
 */
export function createMapLineIcon(name: MapLineIconName, className: string): SVGSVGElement {
  const log = logger.fn('createMapLineIcon', { name });
  const svg = createLineIcon(PATHS[name], ['icon', className]);
  svg.dataset.icon = name;
  return log.exit(svg);
}

/**
 * 便利情報の値に合うアイコンを返す（無ければ undefined）。
 * @param amenity 便利情報の値（toilet / stroller / kids / rainOk / nursing / parking）
 * @returns アイコンの名前
 */
export function amenityIconOf(amenity: string): MapLineIconName | undefined {
  const log = logger.fn('amenityIconOf', { amenity });
  const table: Readonly<Record<string, MapLineIconName>> = { toilet: 'toilet', stroller: 'stroller', kids: 'kids', rainOk: 'rainOk', nursing: 'nursing', parking: 'parking' };
  return log.exit(table[amenity]);
}
