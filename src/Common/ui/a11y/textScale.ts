/**
 * @file 文字拡大設定（Common/ui/a11y 層）
 * html 要素の data-text-scale を切り替え、CSS のルートフォントを 16/18/20px にする（docs/08 §6、CLAUDE.md 6.1）。
 * Canvas の文字は textScaleFactor() 倍で描く。PoC では既定の normal のまま（設定画面は後回し）。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('Common/ui/a11y/textScale');

/** 文字の大きさ（標準／大／特大） */
export type TextScale = 'normal' | 'large' | 'xlarge';

/** 文字の大きさの一覧（設定画面の並び順） */
export const TEXT_SCALES: readonly TextScale[] = ['normal', 'large', 'xlarge'];

/** 各設定の倍率（ルートフォント 16px を 1 とする） */
export const TEXT_SCALE_FACTORS: Readonly<Record<TextScale, number>> = { normal: 1, large: 1.125, xlarge: 1.25 };

/** 各設定の表示名 */
export const TEXT_SCALE_LABELS: Readonly<Record<TextScale, string>> = { normal: '標準', large: '大', xlarge: '特大' };

/**
 * 未検証の値が文字の大きさの設定値か判定する。
 * @param value 判定する値
 * @returns TEXT_SCALES のいずれかなら true
 */
export function isTextScale(value: unknown): value is TextScale {
  return typeof value === 'string' && (TEXT_SCALES as readonly string[]).includes(value);
}

/**
 * 設定値から倍率を返す（純粋関数）。
 * @param scale 文字の大きさ
 * @returns 1 / 1.125 / 1.25
 */
export function factorOf(scale: TextScale): number {
  return TEXT_SCALE_FACTORS[scale];
}

/**
 * 文字の大きさを適用する（html[data-text-scale] を書き換える）。
 * @param scale 文字の大きさ
 * @sideEffect document.documentElement の data-text-scale 属性を変更する
 */
export function applyTextScale(scale: TextScale): void {
  const log = logger.fn('applyTextScale', { scale });
  if (typeof document === 'undefined') {
    log.exit(undefined, 'document が無い環境');
    return;
  }
  document.documentElement.setAttribute('data-text-scale', scale);
  log.exit(undefined);
}

/**
 * 現在の文字の大きさを返す（未設定・不正値は normal）。
 * @returns 文字の大きさ
 */
export function currentTextScale(): TextScale { // audit-ignore: fnlog-missing 毎フレーム描画（textScaleFactor 経由で描画ループから呼ばれる）
  if (typeof document === 'undefined') return 'normal';
  const raw = document.documentElement.getAttribute('data-text-scale');
  return isTextScale(raw) ? raw : 'normal';
}

/**
 * Canvas の文字に掛ける倍率を返す（毎フレーム呼ばれうるのでログは出さない）。
 * @returns 1 / 1.125 / 1.25
 */
export function textScaleFactor(): number { // audit-ignore: fnlog-missing 毎フレーム描画から呼ばれる読み取りヘルパー
  return factorOf(currentTextScale());
}
