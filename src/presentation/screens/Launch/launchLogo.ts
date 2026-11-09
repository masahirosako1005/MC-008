/**
 * @file アプリのロゴ（presentation/screens/Launch）
 * 地図のピンの中で、3棟の街と芽が育つ形（「街に通うほど、自分だけの街が育つ」）。
 * 起動スプラッシュ（index.html の静的な SVG）と同じ形を document.createElementNS で作る（innerHTML は使わない）。
 * 形を変えるときは index.html の SVG もそろえる。色は splash.css の .splash__logo-* で付ける。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/screens/Launch/launchLogo');

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG の部品（要素名・属性） */
type Part = readonly [tag: 'ellipse' | 'path' | 'rect', attrs: Readonly<Record<string, string | number>>];

/** 窓と扉（白） */
const WINDOWS: readonly Part[] = [
  ['rect', { x: 55, y: 39, width: 4, height: 4, rx: 1 }],
  ['rect', { x: 61, y: 39, width: 4, height: 4, rx: 1 }],
  ['rect', { x: 55, y: 46, width: 4, height: 4, rx: 1 }],
  ['rect', { x: 61, y: 46, width: 4, height: 4, rx: 1 }],
  ['rect', { x: 58, y: 57, width: 4, height: 9, rx: 1 }],
  ['rect', { x: 39, y: 54, width: 6, height: 4, rx: 1 }],
  ['rect', { x: 75, y: 48, width: 6, height: 4, rx: 1 }],
  ['rect', { x: 75, y: 55, width: 6, height: 4, rx: 1 }],
];

/** 3棟の建物（ブランド色） */
const TOWN: readonly Part[] = [
  ['rect', { x: 35, y: 49, width: 14, height: 19, rx: 2.5 }],
  ['rect', { x: 51, y: 34, width: 18, height: 34, rx: 2.5 }],
  ['rect', { x: 71, y: 43, width: 14, height: 25, rx: 2.5 }],
];

/** 芽（茎と2枚の葉） */
const SPROUT: readonly Part[] = [
  ['path', { class: 'splash__logo-stem', d: 'M60 34V25' }],
  ['path', { d: 'M60 28c-1-5-5-8-10-7 1 5 5 8 10 7z' }],
  ['path', { d: 'M60 26c1-6 6-9 12-8-1 6-6 9-12 8z' }],
];

/**
 * SVG の要素を作る。
 * @param tag 要素名
 * @param attrs 属性
 * @returns 要素
 */
function svgEl(tag: string, attrs: Readonly<Record<string, string | number>>): SVGElement { // audit-ignore: fnlog-missing 部品ごとに呼ぶ DOM 生成の小さなヘルパー
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * 部品をまとめたグループを作る。
 * @param className グループのクラス
 * @param parts 部品
 * @returns g 要素
 */
function group(className: string, parts: readonly Part[]): SVGElement { // audit-ignore: fnlog-missing createLaunchLogo から3回呼ぶだけの組み立て
  const g = svgEl('g', { class: className });
  for (const [tag, attrs] of parts) g.append(svgEl(tag, attrs));
  return g;
}

/**
 * ロゴの SVG を作る（飾り。読み上げない）。
 * @param className 追加のクラス（省略可）
 * @returns svg 要素
 */
export function createLaunchLogo(className?: string): SVGSVGElement {
  const log = logger.fn('createLaunchLogo');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', ['splash__logo', className].filter(Boolean).join(' '));
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  svg.append(
    svgEl('ellipse', { class: 'splash__logo-shadow', cx: 60, cy: 113, rx: 17, ry: 4 }),
    svgEl('path', { class: 'splash__logo-pin', d: 'M60 110C51 96 22 79 22 50a38 38 0 0 1 76 0c0 29-29 46-38 60z' }),
    group('splash__logo-town', TOWN),
    svgEl('rect', { class: 'splash__logo-ground', x: 31, y: 66, width: 58, height: 4.5, rx: 2.25 }),
    group('splash__logo-win', WINDOWS),
    group('splash__logo-sprout', SPROUT),
  );
  return log.exit(svg);
}
