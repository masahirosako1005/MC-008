/**
 * @file マスタ生成・検証スクリプト用の幾何ユーティリティ（scripts 層・Node 専用）
 * 市の原点（南森町駅）からのメートル座標（x=東, y=北）と緯度経度の相互変換、距離、多角形の内外判定・境界距離・重なり判定、
 * 折れ線（川の中心線）までの距離を提供する。変換係数は docs/08 §5.1（1m ≒ 緯度 1/111,000°、経度 1/91,290°）に従う。
 * 純粋関数のみで副作用はない。
 */

/** 市の原点＝南森町駅（docs/08 §9.2）。メートル座標の基準点。districts.json の city.origin にも書く */
export const CITY_ORIGIN = Object.freeze({ lat: 34.6977, lng: 135.51102 });

/** 緯度1度あたりのメートル数（docs/08 §5.1 の近似値） */
export const METERS_PER_DEG_LAT = 111000;

/** 経度1度あたりのメートル数（北緯34.69度付近。docs/08 §5.1 の近似値） */
export const METERS_PER_DEG_LNG = 91290;

/** 地球の平均半径（メートル）。ハーサイン距離の計算に使う */
export const EARTH_RADIUS_M = 6371008.8;

/** 緯度経度を丸める小数桁数（6桁 ≒ 0.1m） */
export const COORD_DECIMALS = 6;

/**
 * 緯度または経度を小数6桁に丸める。
 * JSON に書く値を決定論的にし、再生成でハッシュが変わらないようにするため。
 * @param {number} value 緯度または経度（度）
 * @returns {number} 小数6桁に丸めた値
 */
export function roundCoord(value) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  const scale = 10 ** COORD_DECIMALS;
  return Math.round(value * scale) / scale;
}

/**
 * 原点からのメートル座標を緯度経度（小数6桁）に変換する。
 * @param {{x: number, y: number}} point 原点からの東方向 x・北方向 y（メートル）
 * @param {{lat: number, lng: number}} [origin] 原点（既定は CITY_ORIGIN）
 * @returns {{lat: number, lng: number}} 緯度経度（度、小数6桁）
 */
export function toLatLng(point, origin = CITY_ORIGIN) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  return {
    lat: roundCoord(origin.lat + point.y / METERS_PER_DEG_LAT),
    lng: roundCoord(origin.lng + point.x / METERS_PER_DEG_LNG),
  };
}

/**
 * 原データの [緯度, 経度] の組を、小数6桁に丸めた {lat, lng} にする。
 * 原データ（scripts/master/source）は緯度経度を直接持つため、出力の丸めをここに集める。
 * @param {readonly [number, number]} pair [緯度, 経度]（度）
 * @returns {{lat: number, lng: number}} 緯度経度（度、小数6桁）
 */
export function latLngOf(pair) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（生成ループで多数回呼ばれる。呼び出し側 build-master でまとめて記録＝docs/04 §2.4-2）
  return { lat: roundCoord(pair[0]), lng: roundCoord(pair[1]) };
}

/**
 * 緯度経度を原点からのメートル座標に戻す（toLatLng の逆変換。丸め誤差は約0.1m）。
 * @param {{lat: number, lng: number}} latLng 緯度経度（度）
 * @param {{lat: number, lng: number}} [origin] 原点（既定は CITY_ORIGIN）
 * @returns {{x: number, y: number}} 東方向 x・北方向 y（メートル）
 */
export function toMeters(latLng, origin = CITY_ORIGIN) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  return {
    x: (latLng.lng - origin.lng) * METERS_PER_DEG_LNG,
    y: (latLng.lat - origin.lat) * METERS_PER_DEG_LAT,
  };
}

/**
 * 2点間の大円距離をハーサイン公式で求める。
 * アプリ側の Distance 実装（正距円筒近似など）との差を見込むため、検証では flatMeters と併用する。
 * @param {{lat: number, lng: number}} a 地点A（度）
 * @param {{lat: number, lng: number}} b 地点B（度）
 * @returns {number} 距離（メートル、丸めなし）
 */
export function haversineMeters(a, b) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 度をラジアンに変換する（純粋な算術ヘルパー）。
 * @param {number} degrees 角度（度）
 * @returns {number} 角度（ラジアン）
 */
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * 2点間の距離を docs/08 §5.1 の換算係数による平面近似で求める。
 * @param {{lat: number, lng: number}} a 地点A（度）
 * @param {{lat: number, lng: number}} b 地点B（度）
 * @returns {number} 距離（メートル、丸めなし）
 */
export function flatMeters(a, b) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  const pa = toMeters(a);
  const pb = toMeters(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

/**
 * 2つの距離計算法（ハーサイン・平面近似）の小さい方と大きい方を返す。
 * 「◯m 以上」の検証は min、「◯m 以内」の検証は max を使い、アプリ側の計算法の違いに耐える。
 * @param {{lat: number, lng: number}} a 地点A（度）
 * @param {{lat: number, lng: number}} b 地点B（度）
 * @returns {{min: number, max: number}} 距離の下限と上限（メートル）
 */
export function distanceBounds(a, b) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  const h = haversineMeters(a, b);
  const f = flatMeters(a, b);
  return { min: Math.min(h, f), max: Math.max(h, f) };
}

/**
 * 点が多角形の内側にあるかを交差数法で判定する（境界上の扱いは不定。境界距離と併用する）。
 * @param {{x: number, y: number}} point 判定する点（メートル座標）
 * @param {ReadonlyArray<{x: number, y: number}>} polygon 多角形の頂点列（閉じ頂点なし）
 * @returns {boolean} 内側なら true。頂点が3未満なら false
 */
export function pointInPolygon(point, polygon) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * 点と線分の最短距離を求める。
 * @param {{x: number, y: number}} point 点（メートル座標）
 * @param {{x: number, y: number}} a 線分の始点
 * @param {{x: number, y: number}} b 線分の終点
 * @returns {number} 最短距離（メートル）
 */
export function distanceToSegment(point, a, b) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * 多角形の辺を [始点, 終点] の組で列挙する（最後の頂点から最初の頂点へ閉じる）。
 * @param {ReadonlyArray<{x: number, y: number}>} polygon 多角形の頂点列
 * @returns {Array<[{x: number, y: number}, {x: number, y: number}]>} 辺の配列
 */
export function edgesOf(polygon) {
  return polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]]);
}

/**
 * 点から多角形の境界（全辺）までの最短距離を求める。
 * スポットが地区境界から十分内側にあるか（docs/08 §5.1: 15m 以上）の検証に使う。
 * @param {{x: number, y: number}} point 点（メートル座標）
 * @param {ReadonlyArray<{x: number, y: number}>} polygon 多角形の頂点列
 * @returns {number} 最短距離（メートル）。頂点が無ければ Infinity
 */
export function distanceToBoundary(point, polygon) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  let best = Infinity;
  for (const [a, b] of edgesOf(polygon)) best = Math.min(best, distanceToSegment(point, a, b));
  return best;
}

/**
 * 3点の向き（外積の符号）を返す。線分交差判定の補助。
 * @param {{x: number, y: number}} p 点P
 * @param {{x: number, y: number}} q 点Q
 * @param {{x: number, y: number}} r 点R
 * @returns {number} 反時計回り 1、時計回り -1、一直線 0
 */
function orientation(p, q, r) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  const value = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

/**
 * 一直線上にある点 r が線分 pq の範囲内にあるか判定する。
 * @param {{x: number, y: number}} p 線分の端点
 * @param {{x: number, y: number}} q 線分の端点
 * @param {{x: number, y: number}} r 判定する点
 * @returns {boolean} 範囲内なら true
 */
function onSegment(p, q, r) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  return (
    Math.min(p.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-9 &&
    Math.min(p.y, q.y) - 1e-9 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-9
  );
}

/**
 * 2つの線分が交わる（接する場合を含む）かを判定する。
 * @param {{x: number, y: number}} a1 線分1の始点
 * @param {{x: number, y: number}} a2 線分1の終点
 * @param {{x: number, y: number}} b1 線分2の始点
 * @param {{x: number, y: number}} b2 線分2の終点
 * @returns {boolean} 交わるなら true
 */
export function segmentsIntersect(a1, a2, b1, b2) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  return o4 === 0 && onSegment(b1, b2, a2);
}

/**
 * 多角形が単純（隣り合わない辺どうしが交わらない）かを判定する。
 * @param {ReadonlyArray<{x: number, y: number}>} polygon 多角形の頂点列
 * @returns {boolean} 単純多角形なら true。頂点が3未満なら false
 */
export function isSimplePolygon(polygon) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const edges = edgesOf(polygon);
  const n = edges.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsIntersect(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) return false;
    }
  }
  return true;
}

/**
 * 2つの多角形が重なる（辺が交わる、または一方の頂点が他方の内側にある）かを判定する。
 * @param {ReadonlyArray<{x: number, y: number}>} p1 多角形1
 * @param {ReadonlyArray<{x: number, y: number}>} p2 多角形2
 * @returns {boolean} 重なるなら true
 */
export function polygonsOverlap(p1, p2) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  for (const [a1, a2] of edgesOf(p1)) {
    for (const [b1, b2] of edgesOf(p2)) {
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return p1.some((v) => pointInPolygon(v, p2)) || p2.some((v) => pointInPolygon(v, p1));
}

/**
 * 重ならない2つの多角形の最短距離（地区間の道・川の幅）を求める。
 * @param {ReadonlyArray<{x: number, y: number}>} p1 多角形1
 * @param {ReadonlyArray<{x: number, y: number}>} p2 多角形2
 * @returns {number} 最短距離（メートル）。重なる場合は 0
 */
export function polygonGap(p1, p2) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  if (polygonsOverlap(p1, p2)) return 0;
  let best = Infinity;
  for (const v of p1) best = Math.min(best, distanceToBoundary(v, p2));
  for (const v of p2) best = Math.min(best, distanceToBoundary(v, p1));
  return best;
}

/**
 * 点から折れ線（川の中心線・道路など）までの最短距離を求める。
 * スポットや公衆トイレが川の中に無いか（中心線から 60m 以上・川幅の半分以上）の検証に使う。
 * @param {{x: number, y: number}} point 点（メートル座標）
 * @param {ReadonlyArray<{x: number, y: number}>} line 折れ線の頂点列（2点以上）
 * @returns {number} 最短距離（メートル）。頂点が1つならその点との距離、0個なら Infinity
 */
export function distanceToPolyline(point, line) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  if (!Array.isArray(line) || line.length === 0) return Infinity;
  if (line.length === 1) return Math.hypot(point.x - line[0].x, point.y - line[0].y);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegment(point, line[i - 1], line[i]));
  return best;
}

/**
 * 直線の歩行経路を一定間隔で区切った点列を返す（始点・終点を必ず含む）。
 * デモの「地図タップで歩く」発見判定（docs/08 §6: 20m ごと）を再現するため。
 * @param {{x: number, y: number}} from 始点（メートル座標）
 * @param {{x: number, y: number}} to 終点（メートル座標）
 * @param {number} stepM 間隔（メートル、正の数）
 * @returns {Array<{x: number, y: number}>} 点列。間隔が不正なら始点と終点のみ
 */
export function samplePath(from, to, stepM) { // audit-ignore: fnlog-missing 純粋な幾何・算術ヘルパー（検証ループで多数回呼ばれる。呼び出し側 masterChecks でまとめて記録＝docs/04 §2.4-2）
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(stepM > 0) || length === 0) return length === 0 ? [{ ...from }] : [{ ...from }, { ...to }];
  const points = [];
  for (let d = 0; d < length; d += stepM) {
    const t = d / length;
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  points.push({ ...to });
  return points;
}
