/**
 * @file ランクの紋章（presentation/screens/Rank 層。SVG を createElementNS で組む＝innerHTML は使わない）
 * 六角形のバッジに段の数字。段ごとの色（銅→銀→金→白金→伝説）は CSS の data-tier で決める（RankScreen.css）。
 * 立体に見せるため、縁の左上を明るく右下を暗くし（面取り）、内側に彫りの線、数字に影を付ける。3段目からは上の頂点に宝石。
 * 4段目からは翼が付き、まだ届いていない段は灰色で鍵の印になる（色だけに頼らない）。飾りなので読み上げない。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/screens/Rank/rankEmblem');

/** SVG の名前空間 */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 色を用意している段の数（これより上の段は最上段の色） */
export const TIER_COUNT = 5;

/** 翼が付く段の添字（4段目以上） */
const WING_FROM_INDEX = 3;

/** 宝石が付く段の添字（3段目以上） */
const GEM_FROM_INDEX = 2;

/** 外側の六角形（viewBox 0..100 × 0..112） */
const OUTER = '50,4 94,29 94,83 50,108 6,83 6,29';
/** 内側の六角形 */
const INNER = '50,15 84,35 84,77 50,97 16,77 16,35';
/** 縁の左上（光が当たる面） */
const RIM_LIGHT = '6,83 6,29 50,4 94,29 84,35 50,15 16,35 16,77';
/** 縁の右下（影の面） */
const RIM_DARK = '94,29 94,83 50,108 6,83 16,77 50,97 84,77 84,35';
/** 内側の彫りの線 */
const ENGRAVE = '50,20 80,37.5 80,74.5 50,92 20,74.5 20,37.5';
/** 上辺のつや */
const SHINE = '16,35 50,15 84,35 84,41 50,22 16,41';
/** 上の頂点の宝石 */
const GEM = '50,-3 57,4 50,11 43,4';
/** 左の翼（右は左右反転） */
const WING = '6,38 -18,26 -12,46 -22,56 -8,62 -16,74 6,74';
/** 鍵の印（中央） */
const LOCK = ['M38 54h24v20H38z', 'M42 54v-6a8 8 0 0 1 16 0v6'];

/** グラデーションの id の通し番号（同じ画面に紋章が何枚あっても id が重ならないようにする） */
let gradientSeq = 0;

/** 紋章のオプション */
export interface EmblemOptions {
  /** まだ届いていない段（灰色・鍵） */
  readonly locked?: boolean;
  /** 付けるクラス（大きさは CSS で決める） */
  readonly className?: string;
}

/**
 * 段の添字を、色を用意している段の範囲に収める。
 * @param index 段の添字（0 始まり）
 * @returns 0..TIER_COUNT-1
 */
export function tierOf(index: number): number {
  return Math.min(TIER_COUNT - 1, Math.max(0, Math.floor(index)));
}

/**
 * SVG の要素を作る。
 * @param tag 要素名
 * @param attrs 属性
 * @returns 要素
 */
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string>>): SVGElementTagNameMap[K] { // audit-ignore: fnlog-missing 紋章1つで数回呼ぶ SVG 要素生成の小さなヘルパー（呼び出し側 createRankEmblem でログ）
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

/**
 * 紋章の中央（影付きの段の数字、または鍵）を作る。
 * @param index 段の添字
 * @param locked まだ届いていない段か
 * @returns 要素
 */
function centerMark(index: number, locked: boolean): SVGElement { // audit-ignore: fnlog-missing 紋章ごとに呼ぶ SVG 組立て（呼び出し側 createRankEmblem でログ）
  const g = svgEl('g', { class: locked ? 'rank-emblem__lock' : 'rank-emblem__mark' });
  if (locked) {
    for (const d of LOCK) g.append(svgEl('path', { d }));
    return g;
  }
  const label = String(index + 1);
  const shadow = svgEl('text', { class: 'rank-emblem__num-shadow', x: '50', y: '61', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  const text = svgEl('text', { class: 'rank-emblem__num', x: '50', y: '58', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  shadow.textContent = label;
  text.textContent = label;
  g.append(shadow, text);
  return g;
}

/**
 * 金属のような縦のグラデーション（上が明るく下が濃い。色は CSS の段の色）を作る。
 * @param id グラデーションの id
 * @returns defs 要素
 */
function metalGradient(id: string): SVGDefsElement { // audit-ignore: fnlog-missing 紋章ごとに呼ぶ SVG 組立て（呼び出し側 createRankEmblem でログ）
  const gradient = svgEl('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' });
  gradient.append(
    svgEl('stop', { offset: '0', class: 'rank-emblem__stop-light' }),
    svgEl('stop', { offset: '0.5', class: 'rank-emblem__stop-mid' }),
    svgEl('stop', { offset: '1', class: 'rank-emblem__stop-deep' }),
  );
  const defs = svgEl('defs', {});
  defs.append(gradient);
  return defs;
}

/**
 * 翼（左右）を作る。
 * @returns 要素
 */
function wings(): SVGGElement { // audit-ignore: fnlog-missing 紋章ごとに呼ぶ SVG 組立て（呼び出し側 createRankEmblem でログ）
  const g = svgEl('g', { class: 'rank-emblem__wings' });
  g.append(svgEl('polygon', { class: 'rank-emblem__wing', points: WING }), svgEl('polygon', { class: 'rank-emblem__wing', points: WING, transform: 'translate(100 0) scale(-1 1)' }));
  return g;
}

/**
 * ランクの紋章を作る。
 * @param index 段の添字（0 始まり）
 * @param opts 鍵・クラス
 * @returns svg 要素（aria-hidden）
 */
export function createRankEmblem(index: number, opts: EmblemOptions = {}): SVGSVGElement {
  const log = logger.fn('createRankEmblem', { index, locked: opts.locked === true });
  const locked = opts.locked === true;
  const svg = svgEl('svg', { viewBox: '-24 0 148 112', 'aria-hidden': 'true', focusable: 'false', class: ['rank-emblem', opts.className ?? ''].join(' ').trim() });
  svg.dataset.tier = locked ? 'locked' : String(tierOf(index));
  const gradientId = `rank-emblem-metal-${++gradientSeq}`;
  svg.append(metalGradient(gradientId));
  if (!locked && index >= WING_FROM_INDEX) svg.append(wings());
  svg.append(
    svgEl('polygon', { class: 'rank-emblem__outer', points: OUTER }),
    svgEl('polygon', { class: 'rank-emblem__rim-light', points: RIM_LIGHT }),
    svgEl('polygon', { class: 'rank-emblem__rim-dark', points: RIM_DARK }),
    svgEl('polygon', { class: 'rank-emblem__inner', points: INNER, fill: `url(#${gradientId})` }),
    svgEl('polygon', { class: 'rank-emblem__engrave', points: ENGRAVE }),
    svgEl('polygon', { class: 'rank-emblem__shine', points: SHINE }),
    centerMark(index, locked),
  );
  if (!locked && index >= GEM_FROM_INDEX) svg.append(svgEl('polygon', { class: 'rank-emblem__gem', points: GEM }));
  return log.exit(svg);
}
