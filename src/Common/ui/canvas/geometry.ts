/**
 * @file 2D 幾何ユーティリティ（Common/ui/canvas 層。純粋関数）
 * 画面座標（CSS px）上の点・矩形・多角形を扱う。地区ポリゴンのタップ判定、ズーム時の当てはめ、ラベル位置に使う。
 * 地図の描画ループ・タップ判定から頻繁に呼ばれるので関数ログは出さない（呼び出し側でまとめてログ）。
 */

/** 画面上の点（CSS px） */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/** 画面上の矩形（CSS px） */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 矩形を表示領域に収めるための拡大率と平行移動 */
export interface FitTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * 2点間の距離を返す。
 * @param a 点1
 * @param b 点2
 * @returns 距離（CSS px）
 */
export function distance2D(a: Point2D, b: Point2D): number { // audit-ignore: fnlog-missing タップ判定で多数回呼ぶ純粋な算術ヘルパー
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 点が多角形の内側にあるか判定する（交差数判定。辺上の扱いは不定）。
 * @param point 判定する点
 * @param polygon 多角形の頂点（3点以上。閉じなくてよい）
 * @returns 内側なら true（3点未満は false）
 */
export function pointInPolygon(point: Point2D, polygon: readonly Point2D[]): boolean { // audit-ignore: fnlog-missing タップ判定で多数回呼ぶ純粋な算術ヘルパー
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const crosses = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * 点群を囲む最小の矩形を返す。
 * @param points 点群
 * @returns 外接矩形（空なら幅高さ 0 の原点）
 */
export function polygonBounds(points: readonly Point2D[]): Rect { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 多角形の重心（面積重心）を返す。面積が 0 に近いときは頂点の平均を返す。
 * @param polygon 多角形の頂点
 * @returns 重心（空なら原点）
 */
export function polygonCentroid(polygon: readonly Point2D[]): Point2D { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  if (polygon.length === 0) return { x: 0, y: 0 };
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a === undefined || b === undefined) continue;
    const cross = a.x * b.y - b.x * a.y;
    area2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area2) < 1e-9) return averagePoint(polygon);
  return { x: cx / (3 * area2), y: cy / (3 * area2) };
}

/**
 * 点群の平均を返す。
 * @param points 点群（1点以上）
 * @returns 平均点
 */
function averagePoint(points: readonly Point2D[]): Point2D { // audit-ignore: fnlog-missing polygonCentroid の内部で呼ぶ純粋な算術ヘルパー
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * 内容の矩形を、余白を残して表示領域の中央に収める拡大率と平行移動を求める（ズーム時の当てはめ）。
 * 画面座標 = 内容座標 × scale + offset。
 * @param content 収めたい内容の矩形
 * @param viewport 表示領域の幅と高さ
 * @param padding 四辺の余白（CSS px、0 以上）
 * @returns 拡大率と平行移動（内容が点や表示領域が狭すぎるときは scale=1 で中央寄せ）
 */
export function fitRectInto(content: Rect, viewport: { readonly width: number; readonly height: number }, padding = 0): FitTransform { // audit-ignore: fnlog-missing ズーム計算で毎フレーム呼びうる純粋な算術ヘルパー
  const availW = viewport.width - padding * 2;
  const availH = viewport.height - padding * 2;
  const canScale = content.width > 0 && content.height > 0 && availW > 0 && availH > 0;
  const scale = canScale ? Math.min(availW / content.width, availH / content.height) : 1;
  return {
    scale,
    offsetX: viewport.width / 2 - (content.x + content.width / 2) * scale,
    offsetY: viewport.height / 2 - (content.y + content.height / 2) * scale,
  };
}

/** 水平線と多角形が重なる区間（x0 ≤ x1） */
export interface Span {
  readonly x0: number;
  readonly x1: number;
}

/**
 * 点と線分の距離を返す（建物を川・道路から離す判定、線ラベルの位置決めに使う）。
 * @param p 点
 * @param a 線分の端点1
 * @param b 線分の端点2
 * @returns 距離（a と b が同じ点なら点どうしの距離）
 */
export function distanceToSegment(p: Point2D, a: Point2D, b: Point2D): number { // audit-ignore: fnlog-missing 建物配置の試行ごとに呼ぶ純粋な算術ヘルパー
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance2D(p, a);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/**
 * 点と折れ線の距離（各線分との距離の最小）を返す。
 * @param p 点
 * @param line 折れ線の頂点（1点なら点との距離、空なら Infinity）
 * @returns 距離
 */
export function distanceToPolyline(p: Point2D, line: readonly Point2D[]): number { // audit-ignore: fnlog-missing 建物配置の試行ごとに呼ぶ純粋な算術ヘルパー
  const first = line[0];
  if (first === undefined) return Infinity;
  let best = distance2D(p, first);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (a !== undefined && b !== undefined) best = Math.min(best, distanceToSegment(p, a, b));
  }
  return best;
}

/**
 * 水平線 y と多角形が重なる区間を左から順に返す（交差数判定と同じ規則。凹んだ多角形では複数区間になる）。
 * @param polygon 多角形の頂点（3点以上）
 * @param y 水平線の y
 * @returns 区間（重ならなければ空）
 */
export function horizontalSpans(polygon: readonly Point2D[], y: number): Span[] { // audit-ignore: fnlog-missing 毎フレーム描画（ラベル位置）で呼ぶ純粋な算術ヘルパー
  if (polygon.length < 3) return [];
  const xs: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > y !== b.y > y) xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
  }
  xs.sort((p, q) => p - q);
  const spans: Span[] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) spans.push({ x0: xs[k] ?? 0, x1: xs[k + 1] ?? 0 });
  return spans;
}

/**
 * 多角形の中に、幅 width・高さ height の箱を置ける行を上から探し、その中心を返す（地区ラベルを上辺寄りに置く）。
 * 箱の上端・中央・下端の3本の水平線すべてで、同じ x 範囲が多角形の内側に入る行を採る。L 字の地区でも内側に置ける。
 * @param polygon 多角形の頂点（CSS px）
 * @param box 置きたい箱の大きさと、上辺から空ける余白（CSS px）
 * @returns 箱の中心（置ける行が無ければ undefined）
 */
export function topLabelSlot(polygon: readonly Point2D[], box: { readonly width: number; readonly height: number; readonly inset: number }): Point2D | undefined { // audit-ignore: fnlog-missing 毎フレーム描画（ラベル位置）で呼ぶ純粋な算術ヘルパー
  const bounds = polygonBounds(polygon);
  const step = Math.max(2, box.height / 4);
  for (let top = bounds.y + box.inset; top + box.height <= bounds.y + bounds.height; top += step) {
    const span = commonSpan([top + 1, top + box.height / 2, top + box.height - 1].map((y) => widestSpan(horizontalSpans(polygon, y))));
    if (span !== undefined && span.x1 - span.x0 >= box.width) return { x: (span.x0 + span.x1) / 2, y: top + box.height / 2 };
  }
  return undefined;
}

/**
 * 区間のうちいちばん広いものを返す。
 * @param spans 区間
 * @returns いちばん広い区間（空なら undefined）
 */
function widestSpan(spans: readonly Span[]): Span | undefined { // audit-ignore: fnlog-missing topLabelSlot の内部で呼ぶ純粋な算術ヘルパー
  let best: Span | undefined;
  for (const s of spans) if (best === undefined || s.x1 - s.x0 > best.x1 - best.x0) best = s;
  return best;
}

/**
 * 区間の共通部分を返す。
 * @param spans 区間（undefined を含めば共通部分なし）
 * @returns 共通部分（無ければ undefined）
 */
function commonSpan(spans: readonly (Span | undefined)[]): Span | undefined { // audit-ignore: fnlog-missing topLabelSlot の内部で呼ぶ純粋な算術ヘルパー
  let x0 = -Infinity;
  let x1 = Infinity;
  for (const s of spans) {
    if (s === undefined) return undefined;
    x0 = Math.max(x0, s.x0);
    x1 = Math.min(x1, s.x1);
  }
  return x1 > x0 ? { x0, x1 } : undefined;
}

/**
 * 多角形の内側にある代表点を返す（重心が内側ならそれ、外側＝L 字などなら重心の高さでいちばん広い区間の中点）。
 * @param polygon 多角形の頂点
 * @returns 代表点
 */
export function interiorPoint(polygon: readonly Point2D[]): Point2D { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const c = polygonCentroid(polygon);
  if (polygon.length < 3 || pointInPolygon(c, polygon)) return c;
  const span = widestSpan(horizontalSpans(polygon, c.y));
  if (span !== undefined) return { x: (span.x0 + span.x1) / 2, y: c.y };
  const box = polygonBounds(polygon);
  const mid = widestSpan(horizontalSpans(polygon, box.y + box.height / 2));
  return mid === undefined ? c : { x: (mid.x0 + mid.x1) / 2, y: box.y + box.height / 2 };
}

/**
 * 2つの矩形が重なるか（辺が接するだけなら重ならない）。
 * @param a 矩形1
 * @param b 矩形2
 * @returns 重なれば true
 */
export function rectsOverlap(a: Rect, b: Rect): boolean { // audit-ignore: fnlog-missing 毎フレーム描画（ラベルの重なり回避）で呼ぶ純粋な算術ヘルパー
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
