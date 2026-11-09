/**
 * @file スポットの街なみ絵のレイアウト（presentation/screens/Spot 層。純粋関数）
 * 種別（名所／店舗）とカテゴリから主役の建物の形を決め、スポットID から決定論的に背景の家並みと木を並べる（Math.random は使わない）。
 * 出力は描画プリミティブ（矩形・多角形・円）の列で、色は役割（role）だけを持つ。色は描画側が訪問状態（カラー／シルエット）で決める。
 */
import type { SpotKindDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { seededRandomFor } from '@/Common/ui/canvas/seededHash';

const logger = createLogger('presentation/screens/Spot/illustrationLayout');

/** 図形の役割（描画側が色を決める） */
export type IllustrationRole = 'ground' | 'bg' | 'bgDark' | 'tree' | 'main' | 'roof' | 'detail';

/** 描画プリミティブ（座標は CSS px） */
export type IllustrationShape =
  | { readonly kind: 'rect'; readonly role: IllustrationRole; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: 'poly'; readonly role: IllustrationRole; readonly points: readonly Point2D[] }
  | { readonly kind: 'circle'; readonly role: IllustrationRole; readonly x: number; readonly y: number; readonly r: number };

/** 主役の建物の形 */
export type MainStyle = 'castle' | 'tower' | 'hall' | 'park' | 'onsen' | 'shopfront' | 'arcade';

/** illustrationLayout の入力 */
export interface IllustrationInput {
  /** 決定論的な乱数の種（スポットID） */
  readonly seed: string;
  readonly kind: SpotKindDto;
  /** マスタのカテゴリ（'史跡'・'カフェ' など） */
  readonly category: string;
  /** 描画領域の幅・高さ（CSS px） */
  readonly width: number;
  readonly height: number;
}

/** 主役の建物の外枠（y が上端、y+h が地面） */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 名所のカテゴリ → 主役の形 */
const LANDMARK_STYLES: Readonly<Record<string, MainStyle>> = {
  '史跡': 'castle',
  '町並み': 'hall',
  '港': 'tower',
  '市場': 'arcade',
  '展望': 'tower',
  '商店街': 'arcade',
  '建築': 'hall',
  '広場': 'park',
  '自然': 'park',
  '温泉': 'onsen',
  '公園': 'park',
  '寄席': 'hall',
  '博物館': 'hall',
  '飲食街': 'arcade',
};

/** 店舗のカテゴリ → 主役の形（無いものは店先） */
const SHOP_STYLES: Readonly<Record<string, MainStyle>> = { '温泉': 'onsen', '銭湯': 'onsen' };

/** 地面の高さ（描画領域の上からの割合） */
export const GROUND_RATIO = 0.8;

/**
 * 種別とカテゴリから主役の建物の形を決める。未知のカテゴリは名所＝館、店舗＝店先。
 * @param kind スポット種別
 * @param category マスタのカテゴリ
 * @returns 主役の形
 */
export function mainStyleOf(kind: SpotKindDto, category: string): MainStyle {
  const log = logger.fn('mainStyleOf', { kind, category });
  const table = kind === 'landmark' ? LANDMARK_STYLES : SHOP_STYLES;
  return log.exit(table[category] ?? (kind === 'landmark' ? 'hall' : 'shopfront'));
}

/**
 * 街なみ絵の図形を並べる（地面 → 背景の家並み・木 → 主役の建物 の順＝描く順）。
 * @param input 種・種別・カテゴリ・描画領域
 * @returns 描画プリミティブの列（同じ入力なら毎回同じ）
 */
export function illustrationLayout(input: IllustrationInput): IllustrationShape[] {
  const log = logger.fn('illustrationLayout', { seed: input.seed, kind: input.kind, width: input.width, height: input.height });
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const groundY = Math.round(height * GROUND_RATIO);
  const mainW = Math.min(width * 0.4, 180);
  const mainH = groundY * 0.7;
  const box: Box = { x: (width - mainW) / 2, y: groundY - mainH, w: mainW, h: mainH };
  const shapes: IllustrationShape[] = [
    { kind: 'rect', role: 'ground', x: 0, y: groundY, w: width, h: height - groundY },
    ...backgroundShapes(input.seed, width, groundY),
    ...mainShapes(mainStyleOf(input.kind, input.category), box),
  ];
  return log.exit(shapes);
}

/**
 * 背景の家並みと木を決定論的に並べる。
 * @param seed 乱数の種（スポットID）
 * @param width 描画領域の幅
 * @param groundY 地面の y 座標
 * @returns 図形の列
 */
function backgroundShapes(seed: string, width: number, groundY: number): IllustrationShape[] {
  const log = logger.fn('backgroundShapes', { seed, width, groundY });
  const random = seededRandomFor(seed);
  const count = 6 + Math.floor(random() * 3);
  const slot = width / count;
  const shapes: IllustrationShape[] = [];
  for (let i = 0; i < count; i++) {
    const w = slot * (0.6 + random() * 0.3);
    const x = Math.min(width - w, i * slot + random() * (slot - w));
    const h = groundY * (0.2 + random() * 0.25);
    const role: IllustrationRole = i % 2 === 0 ? 'bg' : 'bgDark';
    shapes.push({ kind: 'rect', role, x, y: groundY - h, w, h });
    if (random() < 0.5) shapes.push({ kind: 'poly', role: 'bgDark', points: [{ x, y: groundY - h }, { x: x + w, y: groundY - h }, { x: x + w / 2, y: groundY - h - w * 0.35 }] });
  }
  const radius = Math.max(3, groundY * 0.065);
  for (const at of [0.08, 0.92]) {
    const cx = Math.min(width - radius, Math.max(radius, width * (at + (random() - 0.5) * 0.06)));
    shapes.push({ kind: 'circle', role: 'tree', x: cx, y: groundY - radius * 1.1, r: radius });
  }
  return log.exit(shapes);
}

/**
 * 主役の建物の図形を作る。
 * @param style 主役の形
 * @param box 主役の外枠
 * @returns 図形の列
 */
function mainShapes(style: MainStyle, box: Box): IllustrationShape[] {
  const log = logger.fn('mainShapes', { style });
  const builders: Readonly<Record<MainStyle, (b: Box) => IllustrationShape[]>> = {
    castle: castleShapes,
    tower: towerShapes,
    hall: hallShapes,
    park: parkShapes,
    onsen: onsenShapes,
    shopfront: shopfrontShapes,
    arcade: arcadeShapes,
  };
  return log.exit(builders[style](box));
}

/**
 * 外枠に対する割合で矩形を作る。
 * @param b 外枠
 * @param role 役割
 * @param r 割合（x・y・w・h、0〜1）
 * @returns 矩形
 */
function rectIn(b: Box, role: IllustrationRole, r: readonly [number, number, number, number]): IllustrationShape {
  return { kind: 'rect', role, x: b.x + b.w * r[0], y: b.y + b.h * r[1], w: b.w * r[2], h: b.h * r[3] };
}

/**
 * 外枠に対する割合で多角形を作る。
 * @param b 外枠
 * @param role 役割
 * @param points 頂点の割合の列（[x, y]、0〜1）
 * @returns 多角形
 */
function polyIn(b: Box, role: IllustrationRole, points: readonly (readonly [number, number])[]): IllustrationShape {
  return { kind: 'poly', role, points: points.map(([px, py]) => ({ x: b.x + b.w * px, y: b.y + b.h * py })) };
}

/**
 * 城（石垣＋二層の屋根）。
 * @param b 外枠
 * @returns 図形の列
 */
function castleShapes(b: Box): IllustrationShape[] {
  const log = logger.fn('castleShapes');
  return log.exit([
    polyIn(b, 'bgDark', [[0, 1], [1, 1], [0.88, 0.7], [0.12, 0.7]]),
    rectIn(b, 'main', [0.2, 0.42, 0.6, 0.3]),
    polyIn(b, 'roof', [[0.08, 0.46], [0.92, 0.46], [0.5, 0.24]]),
    rectIn(b, 'main', [0.32, 0.18, 0.36, 0.12]),
    polyIn(b, 'roof', [[0.22, 0.2], [0.78, 0.2], [0.5, 0]]),
    rectIn(b, 'detail', [0.3, 0.52, 0.1, 0.1]),
    rectIn(b, 'detail', [0.6, 0.52, 0.1, 0.1]),
  ]);
}

/**
 * 塔（展望台・灯台）。
 * @param b 外枠
 * @returns 図形の列
 */
function towerShapes(b: Box): IllustrationShape[] {
  const log = logger.fn('towerShapes');
  return log.exit([
    rectIn(b, 'main', [0.36, 0.16, 0.28, 0.84]),
    polyIn(b, 'roof', [[0.28, 0.18], [0.72, 0.18], [0.5, 0]]),
    rectIn(b, 'roof', [0.3, 0.42, 0.4, 0.05]),
    rectIn(b, 'detail', [0.45, 0.26, 0.1, 0.1]),
    rectIn(b, 'detail', [0.45, 0.55, 0.1, 0.1]),
    rectIn(b, 'detail', [0.44, 0.8, 0.12, 0.2]),
  ]);
}

/**
 * 館（博物館・名所の大きな建物）。docs/08 §10.5 の現代の街：平らな屋根のガラス張りの建物と、入口のひさし。
 * @param b 外枠
 * @returns 図形の列
 */
function hallShapes(b: Box): IllustrationShape[] {
  const log = logger.fn('hallShapes');
  const panes: IllustrationShape[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) panes.push(rectIn(b, 'detail', [0.13 + col * 0.19, 0.3 + row * 0.17, 0.15, 0.13]));
  }
  return log.exit([
    rectIn(b, 'main', [0.06, 0.2, 0.88, 0.8]),
    rectIn(b, 'roof', [0.02, 0.14, 0.96, 0.07]),
    ...panes,
    rectIn(b, 'detail', [0.4, 0.82, 0.2, 0.18]),
    rectIn(b, 'roof', [0.32, 0.78, 0.36, 0.04]),
  ]);
}

/**
 * 公園・広場（東屋と木）。
 * @param b 外枠
 * @returns 図形の列
 */
function parkShapes(b: Box): IllustrationShape[] {
  const log = logger.fn('parkShapes');
  return log.exit([
    { kind: 'circle', role: 'tree', x: b.x + b.w * 0.14, y: b.y + b.h * 0.55, r: b.w * 0.14 },
    { kind: 'circle', role: 'tree', x: b.x + b.w * 0.86, y: b.y + b.h * 0.5, r: b.w * 0.14 },
    rectIn(b, 'main', [0.32, 0.58, 0.36, 0.42]),
    polyIn(b, 'roof', [[0.22, 0.6], [0.78, 0.6], [0.5, 0.34]]),
    rectIn(b, 'detail', [0.42, 0.74, 0.16, 0.26]),
  ]);
}

/**
 * 温泉（屋根の上に湯けむり）。
 * @param b 外枠
 * @returns 図形の列
 */
function onsenShapes(b: Box): IllustrationShape[] {
  const log = logger.fn('onsenShapes');
  return log.exit([
    rectIn(b, 'main', [0.1, 0.44, 0.8, 0.56]),
    polyIn(b, 'roof', [[0, 0.46], [1, 0.46], [0.84, 0.28], [0.16, 0.28]]),
    rectIn(b, 'detail', [0.36, 0.56, 0.28, 0.2]),
    { kind: 'circle', role: 'bg', x: b.x + b.w * 0.36, y: b.y + b.h * 0.16, r: b.w * 0.06 },
    { kind: 'circle', role: 'bg', x: b.x + b.w * 0.5, y: b.y + b.h * 0.08, r: b.w * 0.07 },
    { kind: 'circle', role: 'bg', x: b.x + b.w * 0.64, y: b.y + b.h * 0.16, r: b.w * 0.06 },
  ]);
}

/**
 * 店先（日よけと看板）。
 * @param b 外枠
 * @returns 図形の列
 */
function shopfrontShapes(b: Box): IllustrationShape[] {
  const log = logger.fn('shopfrontShapes');
  return log.exit([
    rectIn(b, 'main', [0.1, 0.24, 0.8, 0.76]),
    rectIn(b, 'detail', [0.24, 0.29, 0.52, 0.09]),
    polyIn(b, 'roof', [[0.04, 0.56], [0.96, 0.56], [0.88, 0.42], [0.12, 0.42]]),
    rectIn(b, 'detail', [0.18, 0.64, 0.26, 0.2]),
    rectIn(b, 'detail', [0.56, 0.62, 0.22, 0.38]),
  ]);
}

/**
 * アーケード（アーチ屋根と柱）。
 * @param b 外枠
 * @returns 図形の列
 */
function arcadeShapes(b: Box): IllustrationShape[] {
  const log = logger.fn('arcadeShapes');
  const arch: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = (Math.PI * i) / 8;
    arch.push([0.5 - 0.5 * Math.cos(t), 0.36 - 0.3 * Math.sin(t)]);
  }
  return log.exit([
    polyIn(b, 'roof', arch),
    rectIn(b, 'main', [0.02, 0.36, 0.1, 0.64]),
    rectIn(b, 'main', [0.88, 0.36, 0.1, 0.64]),
    rectIn(b, 'detail', [0.18, 0.52, 0.26, 0.48]),
    rectIn(b, 'detail', [0.56, 0.52, 0.26, 0.48]),
    rectIn(b, 'main', [0.02, 0.36, 0.96, 0.06]),
  ]);
}
