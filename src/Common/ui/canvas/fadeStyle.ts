/**
 * @file 色あせの見た目（Common/ui/canvas 層。純粋関数）
 * 色あせは「彩度・透明度・破線・小アイコン ◌」の4重で示す（色覚配慮。docs/08 §6、CLAUDE.md 6.1）。
 * 色あせは見た目だけで、Lv・カード・図鑑・ポイントは減らない（CLAUDE.md 4.3）。毎フレーム呼ばれるので関数ログは出さない。
 */
import { fadedColor } from '@/Common/ui/canvas/colorUtils';

/** 色あせ状態の種類（application の FadeKindDto と同じ値。Common は application を参照できないので再定義） */
export type FadeKind = 'never' | 'fresh' | 'soon' | 'fading';

/** 色あせ中を示す小アイコン */
export const FADE_ICON = '◌';

/** 色あせの描画パラメータ */
export interface FadeVisual {
  /** 彩度の係数（1 で元のまま） */
  readonly saturation: number;
  /** 不透明度の係数（1 で元のまま） */
  readonly alpha: number;
  /** 輪郭を破線にするか */
  readonly dashed: boolean;
  /** 添える小アイコン（色あせ中だけ ◌） */
  readonly icon: '' | typeof FADE_ICON;
}

/** 色あせ開始直後（progress=0）の彩度。開始した瞬間から目に見えて薄くする */
export const FADING_SATURATION_START = 0.55;
/** 最も薄い（progress=1）ときの彩度 */
export const FADING_SATURATION_END = 0.1;
/** 色あせ開始直後の不透明度 */
export const FADING_ALPHA_START = 0.8;
/** 最も薄いときの不透明度 */
export const FADING_ALPHA_END = 0.45;
/** 色あせ間近（soon）の彩度。少しだけ落とす */
export const SOON_SATURATION = 0.85;
/** 色あせ間近（soon）の不透明度 */
export const SOON_ALPHA = 0.95;

/** 元のままの見た目 */
const NORMAL_VISUAL: FadeVisual = { saturation: 1, alpha: 1, dashed: false, icon: '' };

/**
 * 色あせ状態から描画パラメータを求める。
 * fading は progress（0〜1）に応じて彩度 0.55→0.1、不透明度 0.8→0.45 と線形に薄くなり、破線と ◌ を付ける。
 * @param kind 色あせ状態
 * @param progress fading の進み具合（0〜1。範囲外は丸める。省略時 0）
 * @returns 彩度・不透明度・破線・アイコン
 */
export function fadeVisual(kind: FadeKind, progress = 0): FadeVisual { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  if (kind === 'soon') return { saturation: SOON_SATURATION, alpha: SOON_ALPHA, dashed: false, icon: '' };
  if (kind !== 'fading') return NORMAL_VISUAL;
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return {
    saturation: FADING_SATURATION_START + (FADING_SATURATION_END - FADING_SATURATION_START) * p,
    alpha: FADING_ALPHA_START + (FADING_ALPHA_END - FADING_ALPHA_START) * p,
    dashed: true,
    icon: FADE_ICON,
  };
}

/**
 * 地区色に色あせを掛けた塗り色を返す。
 * @param hex 地区の色（'#rrggbb'）
 * @param visual fadeVisual() の結果
 * @param baseAlpha 成長段階などによる元の不透明度（0〜1。省略時 1）
 * @returns 'rgba(r, g, b, a)'
 */
export function fadedFill(hex: string, visual: FadeVisual, baseAlpha = 1): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な変換ヘルパー
  return fadedColor(hex, visual.saturation, baseAlpha * visual.alpha);
}
