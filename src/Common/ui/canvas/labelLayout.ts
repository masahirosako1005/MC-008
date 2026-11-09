/**
 * @file ラベルの重なり回避（Common/ui/canvas 層）
 * 1フレームの中で置いたラベルの矩形を覚えておき、次のラベルは「既存と重ならない最初の候補位置」に置く。どこにも置けなければ省略する。
 * 優先度の高いもの（地区ラベル・出典表示など）から順に置くのは呼び出し側の責任。
 * 地図の描画ループから毎フレーム作り直すので関数ログは出さない（呼び出し側でまとめてログ）。
 */
import { rectsOverlap } from '@/Common/ui/canvas/geometry';
import type { Rect } from '@/Common/ui/canvas/geometry';

/** 1フレーム分のラベル配置 */
export interface LabelLayout {
  /**
   * 必ず置く矩形を登録する（地区ラベル・出典表示・左上のタグなど）。
   * @param rect 矩形（CSS px）
   */
  reserve(rect: Rect): void;
  /**
   * 矩形が表示範囲に収まり、登録済みの矩形とも avoid とも重ならないか。
   * @param rect 矩形
   * @param avoid 追加で避ける矩形（マーカーなど。登録はしない）
   * @returns 置けるなら true
   */
  isFree(rect: Rect, avoid?: readonly Rect[]): boolean;
  /**
   * 候補を順に試し、置ける最初の候補を登録して返す。
   * @param candidates 候補の矩形（優先順）
   * @param avoid 追加で避ける矩形
   * @returns 置いた矩形（どこにも置けなければ undefined＝省略）
   */
  place(candidates: readonly Rect[], avoid?: readonly Rect[]): Rect | undefined;
}

/** LabelLayout の実装（置いた矩形を配列で持つ） */
class SimpleLabelLayout implements LabelLayout {
  private readonly placed: Rect[] = [];

  /**
   * ラベル配置を作る。
   * @param area 表示範囲（省略時は無制限）
   */
  constructor(private readonly area: Rect | undefined) {}

  /**
   * 必ず置く矩形を登録する。
   * @param rect 矩形
   * @sideEffect 登録済みの矩形に加える
   */
  reserve(rect: Rect): void {
    this.placed.push(rect);
  }

  /**
   * 矩形が表示範囲に収まり、登録済みの矩形とも avoid とも重ならないか。
   * @param rect 矩形
   * @param avoid 追加で避ける矩形
   * @returns 置けるなら true
   */
  isFree(rect: Rect, avoid: readonly Rect[] = []): boolean { // audit-ignore: fnlog-missing 毎フレーム描画（ラベルの重なり判定）
    const a = this.area;
    if (a !== undefined && (rect.x < a.x || rect.y < a.y || rect.x + rect.width > a.x + a.width || rect.y + rect.height > a.y + a.height)) return false;
    return !this.placed.some((p) => rectsOverlap(p, rect)) && !avoid.some((p) => rectsOverlap(p, rect));
  }

  /**
   * 候補を順に試し、置ける最初の候補を登録して返す。
   * @param candidates 候補の矩形（優先順）
   * @param avoid 追加で避ける矩形
   * @returns 置いた矩形（無ければ undefined）
   * @sideEffect 置けたら登録済みの矩形に加える
   */
  place(candidates: readonly Rect[], avoid: readonly Rect[] = []): Rect | undefined { // audit-ignore: fnlog-missing 毎フレーム描画（ラベルの配置）
    const hit = candidates.find((c) => this.isFree(c, avoid));
    if (hit !== undefined) this.placed.push(hit);
    return hit;
  }
}

/**
 * ラベル配置を作る。
 * @param area 表示範囲（この外にはみ出す候補は採らない。省略時は無制限）
 * @returns ラベル配置
 */
export function createLabelLayout(area?: Rect): LabelLayout {
  return new SimpleLabelLayout(area);
}

/**
 * 矩形を四方に広げる（ラベルどうしの間に少し隙間を空けるため）。
 * @param rect 矩形
 * @param pad 広げる幅（CSS px）
 * @returns 広げた矩形
 */
export function inflateRect(rect: Rect, pad: number): Rect { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  return { x: rect.x - pad, y: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
}
