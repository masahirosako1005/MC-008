/**
 * @file 色の変換ユーティリティ（Common/ui/canvas 層。純粋関数）
 * '#rrggbb' ⇔ RGB ⇔ HSL の変換、彩度の変更、透明度の付与。色あせ（彩度・透明度）と成長段階の色づけに使う。
 * 地図の描画ループから毎フレーム呼ばれるので関数ログは出さない（呼び出し側でまとめてログ）。
 */
import { clamp01 } from '@/Common/ui/canvas/easing';

/** RGB（各 0〜255 の整数） */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** HSL（h は 0〜360、s・l は 0〜1） */
export interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

/** 不正な色が来たときの代替色（グレー） */
export const FALLBACK_COLOR = '#8a8a8a';

/** '#rgb' / '#rrggbb' の形式 */
const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * '#rgb' または '#rrggbb' を RGB にする。
 * @param hex 色文字列
 * @returns RGB。形式が不正なら undefined
 */
export function parseHexColor(hex: string): Rgb | undefined { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な変換ヘルパー
  if (!HEX_PATTERN.test(hex)) return undefined;
  const body = hex.slice(1);
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/**
 * RGB を '#rrggbb' にする。
 * @param rgb RGB（範囲外は丸める）
 * @returns 小文字の '#rrggbb'
 */
export function rgbToHex(rgb: Rgb): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な変換ヘルパー
  return `#${hexByte(rgb.r)}${hexByte(rgb.g)}${hexByte(rgb.b)}`;
}

/**
 * 0〜255 の値を2桁の16進にする（範囲外は丸める）。
 * @param value 値
 * @returns 2桁の小文字16進
 */
function hexByte(value: number): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な変換ヘルパー
  return Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');
}

/**
 * RGB を HSL にする。
 * @param rgb RGB
 * @returns HSL（h 0〜360、s・l 0〜1）
 */
export function rgbToHsl(rgb: Rgb): Hsl { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s: clamp01(s), l };
}

/**
 * HSL を RGB にする。
 * @param hsl HSL
 * @returns RGB（整数）
 */
export function hslToRgb(hsl: Hsl): Rgb { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const s = clamp01(hsl.s);
  const l = clamp01(hsl.l);
  const h = ((hsl.h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

/**
 * '#rrggbb' を HSL にする。
 * @param hex 色文字列
 * @returns HSL。形式が不正なら代替色（グレー）の HSL
 */
export function hexToHsl(hex: string): Hsl { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な変換ヘルパー
  return rgbToHsl(parseHexColor(hex) ?? parseHexColor(FALLBACK_COLOR) ?? { r: 138, g: 138, b: 138 });
}

/**
 * 彩度に係数を掛けた色を返す（色あせ表現。1 で元のまま、0 でグレー）。
 * @param hex 元の色
 * @param factor 彩度の係数（0〜1）
 * @returns '#rrggbb'
 */
export function scaleSaturation(hex: string, factor: number): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な変換ヘルパー
  const hsl = hexToHsl(hex);
  return rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s * clamp01(factor), l: hsl.l }));
}

/**
 * 透明度を付けた CSS 色文字列にする。
 * @param hex 元の色（不正なら代替色）
 * @param alpha 不透明度（0〜1）
 * @returns 'rgba(r, g, b, a)'
 */
export function toRgba(hex: string, alpha: number): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な変換ヘルパー
  const rgb = parseHexColor(hex) ?? parseHexColor(FALLBACK_COLOR) ?? { r: 138, g: 138, b: 138 };
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(clamp01(alpha) * 1000) / 1000})`;
}

/**
 * 彩度と透明度を同時に変えた色を返す（色あせの塗り色）。
 * @param hex 元の色
 * @param saturationFactor 彩度の係数（0〜1）
 * @param alpha 不透明度（0〜1）
 * @returns 'rgba(r, g, b, a)'
 */
export function fadedColor(hex: string, saturationFactor: number, alpha: number): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な変換ヘルパー
  return toRgba(scaleSaturation(hex, saturationFactor), alpha);
}

/**
 * 2色を混ぜる（t=0 で a、t=1 で b）。成長段階の淡い色づけに使う。
 * @param a 色1
 * @param b 色2
 * @param t 混合率（0〜1）
 * @returns '#rrggbb'
 */
export function mixColors(a: string, b: string, t: number): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const ca = parseHexColor(a) ?? { r: 138, g: 138, b: 138 };
  const cb = parseHexColor(b) ?? { r: 138, g: 138, b: 138 };
  const k = clamp01(t);
  return rgbToHex({ r: ca.r + (cb.r - ca.r) * k, g: ca.g + (cb.g - ca.g) * k, b: ca.b + (cb.b - ca.b) * k });
}
