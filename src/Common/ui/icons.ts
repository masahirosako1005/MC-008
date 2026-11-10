/**
 * @file アプリ共通の SVG アイコン（Common/ui 層）
 * 下部タブ・歯車・再訪理由・カードの矢印などの線のアイコンを document.createElementNS で作る（画像ファイル・innerHTML は使わない）。
 * 線は currentColor（文字色に追従）、角は丸く 1.8px の線幅でそろえる（docs/08 §10.2）。装飾なので aria-hidden を付ける。
 * 図形の d の先頭が '*' なら塗り（線なし）、'~' なら点線で描く。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('Common/ui/icons');

/** SVG の名前空間 */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** アイコンの名前 */
export type IconName =
  | 'map'
  | 'zukan'
  | 'avatar'
  | 'rank'
  | 'ranking'
  | 'gear'
  | 'clock'
  | 'flag'
  | 'fade'
  | 'compass'
  | 'sparkle'
  | 'shop'
  | 'star'
  | 'crown'
  | 'pin'
  | 'wc'
  | 'chevronRight'
  | 'chevronLeft'
  | 'arrowRight'
  | 'close'
  | 'check'
  | 'calendar'
  | 'ticket'
  | 'qr'
  | 'navigate'
  | 'info'
  | 'question'
  | 'footprints'
  | 'card'
  | 'coin'
  | 'camera'
  | 'lantern'
  | 'tree'
  | 'shirt'
  | 'lock'
  | 'person'
  | 'phone'
  | 'shield'
  | 'arrowUp';

/** 円（中心 cx,cy・半径 r）の d 属性を作る（2つの半円弧） */
const circle = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`;

/** 王冠（地区の主・ランキング） */
const CROWN: readonly string[] = ['M4 17.5 3 8l5 4 4-6.5 4 6.5 5-4-1 9.5z', 'M5 20.5h14'];

/** アイコン1つ分の図形（d 属性の列。'*' 始まりは塗り、'~' 始まりは点線） */
const ICON_PATHS: Readonly<Record<IconName, readonly string[]>> = {
  // 折りたたみ地図
  map: ['M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z', 'M9 4.5v13', 'M15 6.5v13'],
  // 開いた本にしおり
  zukan: ['M4 5.5c2.6-.9 5.3-.6 8 1 2.7-1.6 5.4-1.9 8-1v13c-2.6-.9-5.3-.6-8 1-2.7-1.6-5.4-1.9-8-1z', 'M12 6.5v13', 'M16 5v4.5l1.4-1 1.4 1V5.1'],
  // アバター（着せ替え）: 人の上半身にきらめき
  avatar: [circle(11, 8, 3.75), 'M3.5 20.5c.7-4.1 3.6-6.8 7.5-6.8s6.8 2.7 7.5 6.8z', 'M19 2.75v4', 'M17 4.75h4'],
  // ランク: リボン付きのメダルに段の山形
  rank: [circle(12, 15, 5.5), 'M8.5 3.5h7', 'M8.5 3.5l2 6.4', 'M15.5 3.5l-2 6.4', 'M9.5 16.25 12 13.75l2.5 2.5'],
  ranking: CROWN,
  // 歯車（8枚歯）
  gear: [
    'M12 3.2l1.5 2.2 2.6-.6.6 2.6 2.2 1.5-1.2 2.4 1.2 2.4-2.2 1.5-.6 2.6-2.6-.6L12 20.8l-1.5-2.2-2.6.6-.6-2.6-2.2-1.5 1.2-2.4-1.2-2.4 2.2-1.5.6-2.6 2.6.6z',
    circle(12, 12, 2.8),
  ],
  // 期限: 時計
  clock: [circle(12, 12, 8.5), 'M12 7.5V12l3 2'],
  // 取り返し: 旗
  flag: ['M5.5 21V3.5', 'M5.5 4.5h11.5l-2.25 4.25L17 13H5.5'],
  // 色あせ: かすれた円（◌）
  fade: [
    'M13.15 3.83A8.25 8.25 0 0 1 17.93 6.27M19.65 8.91A8.25 8.25 0 0 1 19.93 14.27M18.5 17.08A8.25 8.25 0 0 1 14 20M10.85 20.17A8.25 8.25 0 0 1 6.07 17.73M4.35 15.09A8.25 8.25 0 0 1 4.07 9.73M5.5 6.92A8.25 8.25 0 0 1 10 4',
    '*' + circle(12, 12, 1.6),
  ],
  // 未訪問: コンパス
  compass: [circle(12, 12, 8.5), 'M15.5 8.5l-1.75 5.25L8.5 15.5l1.75-5.25z'],
  // 新着: きらめき
  sparkle: ['M11 3.5l1.9 5.1 5.1 1.9-5.1 1.9L11 17.5l-1.9-5.1L4 10.5l5.1-1.9z', 'M18 15l.8 2.2 2.2.8-2.2.8L18 21l-.8-2.2-2.2-.8 2.2-.8z'],
  // 店: 日よけのある店先
  shop: ['M4.5 10.5V20h15v-9.5', 'M3.5 9.5 5 4.5h14l1.5 5', 'M3.5 9.5a2.1 2.1 0 0 0 4.25 0 2.1 2.1 0 0 0 4.25 0 2.1 2.1 0 0 0 4.25 0 2.1 2.1 0 0 0 4.25 0', 'M10 20v-5h4v5'],
  // 名所: 星
  star: ['M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z'],
  crown: CROWN,
  // ピン（現在地からの距離など）
  pin: ['M12 21s-6.5-6.1-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.9 12 21 12 21z', circle(12, 9.8, 2.4)],
  // トイレ（男女のピクト）
  wc: [circle(7, 5, 1.6), 'M5 9h4l.5 5.5H8.25V20h-2.5v-5.5H4.5z', circle(17, 5, 1.6), 'M17 9l2.75 7H18v4h-2v-4h-1.75z', 'M12 3.5v17'],
  chevronRight: ['M9.5 6l6 6-6 6'],
  chevronLeft: ['M14.5 6l-6 6 6 6'],
  arrowRight: ['M4.5 12h15', 'M13.5 6l6 6-6 6'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  // カレンダー
  calendar: ['M6 5.5h12a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2z', 'M4 10h16', 'M8.5 3.5v4', 'M15.5 3.5v4'],
  // クーポン: 切り取り線のある券
  ticket: ['M4 6.5h16v3.25a2.25 2.25 0 0 0 0 4.5v3.25H4v-3.25a2.25 2.25 0 0 0 0-4.5z', '~M14.5 7v10'],
  /** QR（店頭QR。3つの角の四角と右下の点） */
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2.5v2.5H14z', 'M20 14v.01', 'M17.5 20H20v-2.5', 'M14 20v.01'],
  // 進む方向（ナビ）
  navigate: ['M12 3.5l7 17-7-4-7 4z'],
  info: [circle(12, 12, 8.5), 'M12 11v5.5', '*' + circle(12, 7.75, 1.1)],
  question: [circle(12, 12, 8.5), 'M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6v.7', '*' + circle(12, 16.9, 1.1)],
  // 通った回数: 足あと
  footprints: [
    'M8 3.5c-1.7 0-2.8 1.9-2.8 4.6 0 2 .7 3.5.7 5.2h4.2c0-1.7.7-3.2.7-5.2 0-2.7-1.1-4.6-2.8-4.6z',
    'M6 15.8h3.9v.9a1.95 1.95 0 0 1-3.9 0z',
    'M16 6.5c1.7 0 2.8 1.9 2.8 4.6 0 2-.7 3.5-.7 5.2h-4.2c0-1.7-.7-3.2-.7-5.2 0-2.7 1.1-4.6 2.8-4.6z',
    'M14.1 18.8H18v.2a1.95 1.95 0 0 1-3.9 0z',
  ],
  // カード（縦長の札に絵の枠）
  card: ['M7 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z', 'M5 14h14', 'M9 17.25h6'],
  // ポイント: コイン
  coin: [circle(12, 12, 8.5), circle(12, 12, 5.25)],
  camera: ['M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', circle(12, 12.5, 3.25)],
  // 吊り下げの明かり
  lantern: ['M12 2.5v3', 'M8 5.5h8', 'M8.5 5.5C7.3 7.5 6.75 9.7 6.75 12.25S7.3 17 8.5 19h7c1.2-2 1.75-4.2 1.75-6.75S16.7 7.5 15.5 5.5', 'M8 19h8', 'M12 19v2.5', 'M7 12.25h10'],
  // 木
  tree: ['M12 3.5a5 5 0 0 0-4.7 6.7A4.5 4.5 0 0 0 9 18h6a4.5 4.5 0 0 0 1.7-7.8A5 5 0 0 0 12 3.5z', 'M12 12v9'],
  arrowUp: ['M12 19.5v-15', 'M6 10.5l6-6 6 6'],
  // 着せ替え: シャツ
  shirt: ['M8.5 4 4 6.5l1.5 4 2-.5V20h9v-10l2 .5 1.5-4L15.5 4c-.5 1.4-1.9 2.3-3.5 2.3S9 5.4 8.5 4z'],
  // 鍵（まだ届いていない段）
  lock: ['M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  // 人（旅人）
  person: [circle(12, 7.5, 3.5), 'M5 20.5c.6-3.9 3.4-6.5 7-6.5s6.4 2.6 7 6.5z'],
  // 端末（この端末に保存）
  phone: ['M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5z', 'M10.5 18.5h3'],
  // 盾（ランクは下がらない）
  shield: ['M12 3 19 5.75v5.5c0 4.6-2.9 8.1-7 9.75-4.1-1.65-7-5.15-7-9.75v-5.5z', 'M9 12l2.25 2.25L15.5 10'],
};

/**
 * 図形1つ分の path 要素を作る（'*' 始まりは塗り、'~' 始まりは点線）。
 * @param spec d 属性（先頭に '*' または '~' を付けられる）
 * @returns path 要素
 */
function createPath(spec: string): SVGPathElement {
  const log = logger.fn('createPath', { mark: spec.charAt(0) });
  const path = document.createElementNS(SVG_NS, 'path');
  const mark = spec.charAt(0);
  path.setAttribute('d', mark === '*' || mark === '~' ? spec.slice(1) : spec);
  if (mark === '*') {
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('stroke', 'none');
  }
  if (mark === '~') path.setAttribute('stroke-dasharray', '2 2.5');
  return log.exit(path);
}

/**
 * 図形の列から線のアイコンの svg 要素を作る（24×24 の viewBox、線は currentColor、角は丸い）。画面ごとのアイコン（アバター画面など）もこれで作る。
 * @param specs d 属性の列（'*' 始まりは塗り、'~' 始まりは点線）
 * @param classNames 付けるクラス名
 * @param strokeWidth 線幅（viewBox の単位。既定 1.8）
 * @returns svg 要素（aria-hidden="true"）
 */
export function createLineIcon(specs: readonly string[], classNames: readonly string[], strokeWidth = 1.8): SVGSVGElement {
  const log = logger.fn('createLineIcon', { count: specs.length, classNames });
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add(...classNames);
  for (const spec of specs) svg.append(createPath(spec));
  return log.exit(svg);
}

/**
 * 線のアイコンの svg 要素を作る（24×24 の viewBox、線は currentColor）。大きさは CSS（.icon）で決める。
 * @param name アイコンの名前
 * @returns svg 要素（aria-hidden="true"）
 */
export function createIcon(name: IconName): SVGSVGElement {
  const log = logger.fn('createIcon', { name });
  return log.exit(createLineIcon(ICON_PATHS[name], ['icon', `icon--${name}`]));
}

/**
 * 共通アイコンの図形（d 属性の列）を返す（画面ごとのアイコンに組み込むとき）。
 * @param name アイコンの名前
 * @returns d 属性の列
 */
export function iconPathsOf(name: IconName): readonly string[] {
  const log = logger.fn('iconPathsOf', { name });
  return log.exit(ICON_PATHS[name]);
}

/**
 * 文字列がアイコンの名前か判定する。
 * @param value 調べる文字列
 * @returns アイコンの名前なら true
 */
export function isIconName(value: string): value is IconName {
  const log = logger.fn('isIconName', { value });
  return log.exit(Object.prototype.hasOwnProperty.call(ICON_PATHS, value));
}
