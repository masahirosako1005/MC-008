/**
 * @file アバター画面のアイコン（presentation/screens/Avatar 層。SVG の線画）
 * カテゴリのタブ・操作・鍵・NEW まわりの印を、色も塗りも使わない線だけのアイコンで作る（2026-11-10 ユーザー指示「下部タブと同じように線で」。それまでは canvas の色つきの絵）。
 * 作り方は Common/ui/icons と同じ（24×24 の viewBox・線は currentColor・角は丸い）。色は置く場所の文字色に従い、地が絵や色の上なら CSS で白い丸などを敷く。
 * 共通アイコンにある形（きらめき・シャツ・カメラ・鍵）はそれを使う。着せ替えの絵・部品の絵・ポーズのミニアバターは絵なのでここでは扱わない。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createLineIcon, iconPathsOf } from '@/Common/ui/icons';

const logger = createLogger('presentation/screens/Avatar/avatarIcons');

/** アイコンの名前 */
export type AvatarIconName =
  | 'pickup' | 'hair' | 'face' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'held' | 'pet' | 'background' | 'object' | 'title' | 'coord'
  | 'aura' | 'emote' | 'spring' | 'summer' | 'autumn' | 'winter'
  | 'undo' | 'random' | 'photo' | 'bag' | 'lock' | 'key' | 'party' | 'none' | 'check' | 'tag';

/** 小数を2桁に丸めた文字列（d 属性を短くする） */
const fx = (n: number): string => String(Math.round(n * 100) / 100); // audit-ignore: fnlog-missing 1行の数値の整形（図形を作るときに数百回呼ぶ）

/** 円（中心 cx,cy・半径 r）の d 属性 */
const circle = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`;

/** 真上から時計回りに測った角 a・半径 r の点（"x y"） */
const polar = (cx: number, cy: number, a: number, r: number): string => `${fx(cx + Math.sin(a) * r)} ${fx(cy - Math.cos(a) * r)}`;

/**
 * 花びらの輪郭（真上から一周たどる閉じた線）。t は花びら1枚の中での位置（-1〜1、0 が花びらの先）。
 * @param cx 中心 X
 * @param cy 中心 Y
 * @param petals 花びらの数
 * @param radiusAt 花びらの中の位置 t → 半径
 * @returns d 属性
 */
const petalOutline = (cx: number, cy: number, petals: number, radiusAt: (t: number) => number): string => {
  const log = logger.fn('petalOutline', { petals });
  const steps = petals * 24;
  const span = (Math.PI * 2) / petals;
  const pts: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i * Math.PI * 2) / steps;
    const t = (((a + span / 2) % span) / span) * 2 - 1;
    pts.push(polar(cx, cy, a, radiusAt(t)));
  }
  return log.exit(`M${pts.join('L')}z`);
};

/**
 * 星形の閉じた線（とがりの数・外と内の半径）。
 * @param cx 中心 X
 * @param cy 中心 Y
 * @param points とがりの数
 * @param outer 外の半径
 * @param inner 内の半径
 * @returns d 属性
 */
const starOutline = (cx: number, cy: number, points: number, outer: number, inner: number): string => {
  const log = logger.fn('starOutline', { points });
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i += 1) pts.push(polar(cx, cy, (i * Math.PI) / points, i % 2 === 0 ? outer : inner));
  return log.exit(`M${pts.join('L')}z`);
};

/**
 * 雪の結晶（6本の腕と、腕ごとの V の枝）。
 * @returns d 属性の列
 */
const snowflake = (): readonly string[] => {
  const log = logger.fn('snowflake');
  const out: string[] = [];
  for (let k = 0; k < 6; k += 1) {
    const a = (k * Math.PI) / 3;
    out.push(`M12 12L${polar(12, 12, a, 9)}`, `M${polar(12, 12, a - 0.42, 8)}L${polar(12, 12, a, 5.5)}L${polar(12, 12, a + 0.42, 8)}`);
  }
  return log.exit(out);
};

/** 桜: 先に切れ込みのある5枚の丸い花びら */
const SAKURA = petalOutline(12, 12, 5, (t) => {
  const round = 4 + 5.5 * Math.sqrt(Math.max(0, 1 - t * t));
  return Math.abs(t) < 0.18 ? round - 1.8 * (1 - Math.abs(t) / 0.18) : round;
});

/** ひまわり: 12枚の花びらと真ん中の円 */
const SUNFLOWER = petalOutline(12, 12, 12, (t) => 6.25 + 3.25 * (1 - t * t));

/** アイコンごとの図形（d 属性の列。'*' 始まりは小さな点の塗り、'~' 始まりは点線） */
const SHAPES: Readonly<Record<AvatarIconName, readonly string[]>> = {
  // ピックアップ: きらめき
  pickup: iconPathsOf('sparkle'),
  // 髪型: ボブの髪の内側に目のある顔
  hair: [
    'M4 19V11.5a8 8 0 0 1 16 0V19', 'M4 19h3.5', 'M20 19h-3.5', 'M7.5 12v7', 'M16.5 12v7', 'M7.5 15.5a4.5 4.5 0 0 0 9 0',
    'M7.5 12c2-.4 3.6-1.6 4.5-3.5.9 1.9 2.5 3.1 4.5 3.5', '*' + circle(10.25, 14.4, 0.85), '*' + circle(13.75, 14.4, 0.85),
  ],
  // 顔: にっこり目と口
  face: [circle(12, 12, 8.5), 'M7.75 11q1.25-1.6 2.5 0', 'M13.75 11q1.25-1.6 2.5 0', 'M9 14.25q3 3 6 0'],
  // トップス: シャツ
  top: iconPathsOf('shirt'),
  // ボトムス: ズボン
  bottom: ['M6.5 3.5h11l1.5 17h-4.5L12 10.5l-2.5 10H5z', 'M6.25 6.5h11.5'],
  // くつ: スニーカー
  shoes: ['M3.5 16V7.5h5l2.75 3.75 6.25 1.5A3.5 3.5 0 0 1 20.5 16', 'M3 16h18v1.25a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M8.75 10.25l1.75-.9', 'M10.25 12.5l1.75-.9'],
  // 帽子: つばのある帽子
  hat: [
    'M6.5 14.75V10a5.5 5.5 0 0 1 11 0v4.75', 'M6.5 14.75c1.5.5 3.4.75 5.5.75s4-.25 5.5-.75', 'M6.5 12.25c1.5.45 3.4.7 5.5.7s4-.25 5.5-.7',
    'M6.5 13.25C4 13.75 2.5 14.6 2.5 15.5c0 1.5 4.25 2.75 9.5 2.75s9.5-1.25 9.5-2.75c0-.9-1.5-1.75-4-2.25',
  ],
  // アクセ: リボン
  accessory: [
    'M10.25 10.5C7 7.5 3.5 6.5 3.5 9.25v5.5c0 2.75 3.5 1.75 6.75-1.25', 'M13.75 10.5C17 7.5 20.5 6.5 20.5 9.25v5.5c0 2.75-3.5 1.75-6.75-1.25',
    'M11 10h2a.75.75 0 0 1 .75.75v2.5A.75.75 0 0 1 13 14h-2a.75.75 0 0 1-.75-.75v-2.5A.75.75 0 0 1 11 10z', 'M10.75 14l-1.75 6.5', 'M13.25 14l1.75 6.5',
  ],
  // 持ち物: カメラ
  held: iconPathsOf('camera'),
  // 相棒: ねこの顔
  pet: ['M4.5 13.5V4.5l4.25 3.25h6.5L19.5 4.5v9c0 4-3.4 6.5-7.5 6.5s-7.5-2.5-7.5-6.5z', '*' + circle(9, 13, 1.1), '*' + circle(15, 13, 1.1), 'M10.75 16l1.25 1 1.25-1'],
  // 背景: 丘と太陽の額
  background: ['M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z', 'M3 16l4.5-4.5L13 17l2.5-2.5 4 4', circle(16, 8.75, 1.75)],
  // オブジェ: ベンチ
  object: ['M4 6h16', 'M4 9.5h16', 'M3 13h18', 'M6 6v7', 'M18 6v7', 'M5 13v6.5', 'M19 13v6.5'],
  // 称号: 星の入った札とリボン
  title: [
    'M5 4.5h14A1.5 1.5 0 0 1 20.5 6v7.5A1.5 1.5 0 0 1 19 15H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5z', starOutline(12, 9.9, 5, 3.3, 1.4),
    'M7.5 15 6 20l2.25-1.25L9.75 20l.75-5', 'M16.5 15l1.5 5-2.25-1.25L14.25 20l-.75-5',
  ],
  // マイコーデ: ハンガー
  coord: ['M12 9.5V8.4a1.9 1.9 0 1 1 1.9-1.9', 'M12 9.5 3.25 15.1a.9.9 0 0 0 .5 1.65h16.5a.9.9 0 0 0 .5-1.65z'],
  // オーラ: 人をつつむ光の輪（点線）
  aura: ['~' + circle(12, 12, 9.25), circle(12, 9.25, 2.75), 'M7 18c.6-3.1 2.6-5 5-5s4.4 1.9 5 5'],
  // エモート: ハートの入った吹き出し
  emote: [
    'M12 3.5c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.15-2.9-.45L4.5 19.5l1.2-3.7C4.3 14.5 3.5 12.6 3.5 10.5c0-3.9 3.8-7 8.5-7z',
    'M12 13.75c-2.5-1.5-3.5-2.9-3.5-4.1a1.75 1.75 0 0 1 3.5-.55 1.75 1.75 0 0 1 3.5.55c0 1.2-1 2.6-3.5 4.1z',
  ],
  // 春: 桜
  spring: [SAKURA, circle(12, 12, 1.5)],
  // 夏: ひまわり
  summer: [SUNFLOWER, circle(12, 12, 3.5)],
  // 秋: もみじ
  autumn: [
    'M12 2.5L13.6 6.2L15.6 5.2L15.2 8.6L20.5 6.8L18.8 10.2L20 11.2L16.6 13L17.8 15.6L13.2 14.6L12 16.5L10.8 14.6L6.2 15.6L7.4 13L4 11.2L5.2 10.2L3.5 6.8L8.8 8.6L8.4 5.2L10.4 6.2z',
    'M12 16.5v5',
  ],
  // 冬: 雪の結晶
  winter: snowflake(),
  // 元に戻す: 左回りの矢印
  undo: ['M4 12a8 8 0 1 0 2.35-5.65L4 8.7', 'M4 4.5v4.2h4.2'],
  // おまかせ: サイコロ
  random: [
    'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z',
    '*' + circle(8.75, 8.75, 1.15), '*' + circle(15.25, 8.75, 1.15), '*' + circle(12, 12, 1.15), '*' + circle(8.75, 15.25, 1.15), '*' + circle(15.25, 15.25, 1.15),
  ],
  // 撮影: カメラとフラッシュの光
  photo: [...iconPathsOf('camera'), 'M20.5 1.75v3', 'M19 3.25h3'],
  // 持っている数: 紙袋
  bag: ['M5 8h14l1.25 12.5H3.75z', 'M9 10.5V7a3 3 0 0 1 6 0v3.5'],
  // 鍵がかかっている: 南京錠
  lock: iconPathsOf('lock'),
  // 手に入れ方: 鍵
  key: [circle(7.5, 12, 3.75), 'M11.25 12h9.25v3', 'M17 12v2.5'],
  // 手に入れたばかり: クラッカーと紙吹雪
  party: ['M3.5 20.5 8 8.5l7.5 7.5z', 'M5.5 15.1 8.9 18.5', 'M12 7c.4-1.4 1.3-2.4 2.75-2.9', 'M16 11.5c1.2-.9 2.5-1.2 3.9-.8', '*' + circle(11, 3.5, 1), '*' + circle(19.5, 6, 1), '*' + circle(19.25, 15.5, 1)],
  // なし: 斜線の丸
  none: [circle(12, 12, 7.5), 'M6.7 17.3 17.3 6.7'],
  // 身につけている: 丸にチェック
  check: [circle(12, 12, 9), 'M7.75 12.25l2.75 2.75 5.75-5.75'],
  // 称号の札（ピックアップ）
  tag: ['M3.5 12 8.75 5.5H19.5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8.75z', circle(8.75, 12, 1.25), 'M12.5 10h5', 'M12.5 14h3.5'],
};

/**
 * 表示の大きさに合う線幅（viewBox の単位）。小さいと線が細く見えるので太くし、大きいと太く見えるので細くする。
 * @param size 一辺（CSS px）
 * @returns 線幅
 */
const strokeWidthOf = (size: number): number => (size <= 14 ? 2.2 : size >= 32 ? 1.6 : 1.8);

/**
 * アイコンの svg を作る（線だけ。色は置く場所の文字色に従う）。
 * @param name アイコンの名前
 * @param size 一辺（CSS px）
 * @param className 追加のクラス名
 * @returns svg（読み上げは隠す。意味は隣の文字で伝える）
 */
export function createAvatarIcon(name: AvatarIconName, size: number, className?: string): SVGSVGElement {
  const log = logger.fn('createAvatarIcon', { name, size });
  const classes = ['icon', 'avatar-icon', `avatar-icon--${name}`];
  if (className !== undefined) classes.push(className);
  const svg = createLineIcon(SHAPES[name], classes, strokeWidthOf(size));
  svg.style.setProperty('width', `${size}px`);
  svg.style.setProperty('height', `${size}px`);
  return log.exit(svg);
}

/**
 * 小さなアイコンと文字を並べた行を作る（見出し・手に入れ方など）。
 * @param name アイコンの名前
 * @param text 文字
 * @param size アイコンの一辺（CSS px）
 * @returns 要素
 */
export function iconText(name: AvatarIconName, text: string, size = 16): HTMLElement {
  return h('span', { class: 'avatar-icon-text' }, [createAvatarIcon(name, size), h('span', { text })]);
}
