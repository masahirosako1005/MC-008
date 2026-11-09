/**
 * @file ポイントの値オブジェクト（domain/reward 層）
 * ポイントは 0 以上の安全な整数だけを表す（小数・負値・非数は作れない＝docs/03 §4、DI-02）。
 * 実体は number のブランド型なので、画面・DTO・イベントへはそのまま number として渡せる。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { Brand } from '@/Common/types/Brand';
import { isNonNegativeInteger } from '@/Common/utils/number';

const logger = createLogger('domain/reward/Points');

/** ポイント（0 以上の安全な整数）。Points.of を通してだけ作る */
export type Points = Brand<number, 'Points'>;

/**
 * 検証済みの数値をポイントにする内部処理（ここ以外でブランドを付けない）。
 * @param value 0 以上の安全な整数であることを確認済みの値
 * @returns ポイント
 */
function brandPoints(value: number): Points {
  return value as Points; // 検証済みの値にだけ印を付ける（ブランド型の生成はこの1か所）
}

/**
 * ポイントとして不正な値の失敗を作る。値そのものは入れず、型名だけを details に入れる。
 * @param reason 不正の理由（'notInteger' など）
 * @returns INVALID_INPUT の失敗
 */
function invalidPoints(reason: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', 'ポイントの値が正しくありません', { kind: 'Points', reason }));
}

/** Points のファクトリと演算（型と同名の値。`Points.of(10)` と書ける） */
export const Points = {
  /** 0 ポイント */
  ZERO: brandPoints(0),

  /**
   * 未検証の値をポイントにする。0 以上の安全な整数だけを受け付ける（小数・負値・NaN・Infinity・文字列は拒否）。
   * @param raw 未検証の値
   * @returns 成功: Points（-0 は 0 にそろえる）。失敗: INVALID_INPUT（details.reason: notNumber / negative / notInteger / tooLarge）
   */
  of(raw: unknown): Result<Points> {
    const log = logger.fn('of', { raw: typeof raw === 'number' ? raw : typeof raw });
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return log.fail(invalidPoints('notNumber'));
    if (raw < 0) return log.fail(invalidPoints('negative'));
    if (!Number.isInteger(raw)) return log.fail(invalidPoints('notInteger'));
    if (!isNonNegativeInteger(raw)) return log.fail(invalidPoints('tooLarge'));
    return log.exit(ok(brandPoints(raw + 0)));
  },

  /**
   * 2つのポイントを足す。結果が安全な整数の範囲を超える場合は失敗にする（黙って丸めない）。
   * @param a 足されるポイント
   * @param b 足すポイント
   * @returns 成功: 合計の Points。失敗: INVALID_INPUT（安全な整数の範囲を超えた）
   */
  add(a: Points, b: Points): Result<Points> {
    const log = logger.fn('add', { a, b });
    const sum = a + b;
    if (!isNonNegativeInteger(sum)) return log.fail(invalidPoints('tooLarge'));
    return log.exit(ok(brandPoints(sum)));
  },
};
