/**
 * @file 育成リング（Common/ui 層）。このアプリのシグネチャー記号
 * 地区の成長段階（Lv0〜3）を「3分割の円弧リング＋中央の数字」で示す。満ちた弧は地区色、残りは淡いグレー。
 * 地図の地区の札（Canvas 版は presentation/screens/Map/mapPins.ts の drawGrowthRing）・図鑑の地区カード・ランキングの「主：○○」で共通に使う。
 * SVG は document.createElementNS で作る（innerHTML は使わない）。色は CSS 変数 --district（無ければ currentColor）。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('Common/ui/growthRing');

/** SVG の名前空間 */
const SVG_NS = 'http://www.w3.org/2000/svg';
/** 成長段階の上限（3分割） */
export const GROWTH_RING_SEGMENTS = 3;
/** 弧と弧のすきま（度） */
const SEGMENT_GAP_DEG = 14;

/** createGrowthRing のオプション */
export interface GrowthRingOptions {
  /** 成長段階（0〜3。範囲外は丸める） */
  readonly level: number;
  /** 読み上げの文言（省略時「成長レベル n」）。装飾として隠すなら hidden=true */
  readonly label?: string;
  /** 読み上げから隠す（隣に同じ情報の文字があるとき） */
  readonly hidden?: boolean;
  /** 中央に数字を出さない（地区の印として使うとき） */
  readonly emblem?: boolean;
}

/**
 * 円弧の d 属性を作る（中心 12,12、半径 9.5 の円周上、角度は上を 0 度として時計回り）。
 * @param fromDeg 始まりの角度（度）
 * @param toDeg 終わりの角度（度）
 * @returns path の d
 */
export function ringArcPath(fromDeg: number, toDeg: number): string { // audit-ignore: fnlog-missing 描画ごとに呼ぶ純粋な算術ヘルパー
  const r = 9.5;
  /**
   * 角度から円周上の点（"x y"）を返す。
   * @param deg 角度（度。上が 0）
   * @returns 座標の文字列
   */
  const pt = (deg: number): string => { // audit-ignore: fnlog-missing 描画ごとに呼ぶ純粋な算術ヘルパー
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(12 + r * Math.cos(rad)).toFixed(2)} ${(12 + r * Math.sin(rad)).toFixed(2)}`;
  };
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M${pt(fromDeg)}A${r} ${r} 0 ${large} 1 ${pt(toDeg)}`;
}

/**
 * 育成リングの svg 要素を作る（class="growth-ring"、data-level=段階）。
 * @param opts 段階・読み上げ・数字の有無
 * @returns svg 要素
 */
export function createGrowthRing(opts: GrowthRingOptions): SVGSVGElement {
  const log = logger.fn('createGrowthRing', { level: opts.level, emblem: opts.emblem === true });
  const level = Number.isFinite(opts.level) ? Math.min(GROWTH_RING_SEGMENTS, Math.max(0, Math.round(opts.level))) : 0;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'growth-ring');
  svg.setAttribute('data-level', String(level));
  if (opts.hidden === true) svg.setAttribute('aria-hidden', 'true');
  else {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.label ?? `成長レベル ${level}`);
  }
  const span = 360 / GROWTH_RING_SEGMENTS;
  for (let i = 0; i < GROWTH_RING_SEGMENTS; i++) {
    const arc = document.createElementNS(SVG_NS, 'path');
    arc.setAttribute('d', ringArcPath(i * span + SEGMENT_GAP_DEG / 2, (i + 1) * span - SEGMENT_GAP_DEG / 2));
    arc.setAttribute('class', i < level || opts.emblem === true ? 'growth-ring__arc growth-ring__arc--on' : 'growth-ring__arc');
    svg.append(arc);
  }
  if (opts.emblem !== true) {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', '12');
    text.setAttribute('y', '12');
    text.setAttribute('class', 'growth-ring__num');
    text.textContent = String(level);
    svg.append(text);
  }
  return log.exit(svg);
}
