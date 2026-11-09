/**
 * @file 期間（開始日〜終了日、両端を含む JST 暦日）の値オブジェクト（domain/revisit 層）
 * クーポン・イベントの期限判定に使う。Period.of でしか作れず、開始 ≦ 終了を保証する（DI-02, DI-09）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { compareLocalDate, daysBetween, parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';

const logger = createLogger('domain/revisit/Period');

/** 期間。start ≦ end。両端の日を含む */
export class Period {
  /**
   * 検証済みの値から作る（外からは Period.of を使う）。
   * @param start 開始日（含む）
   * @param end 終了日（含む）
   */
  private constructor(
    readonly start: LocalDate,
    readonly end: LocalDate,
  ) {
    Object.freeze(this);
  }

  /**
   * 開始日と終了日から期間を作る。
   * @param start 開始日（含む）
   * @param end 終了日（含む）
   * @returns 成功: Period。失敗: INVALID_INPUT（開始が終了より後）
   */
  static of(start: LocalDate, end: LocalDate): Result<Period> {
    const log = logger.fn('of', { start, end });
    if (compareLocalDate(start, end) > 0) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '期間の開始日が終了日より後になっています', { kind: 'Period' })));
    }
    return log.exit(ok(new Period(start, end)));
  }

  /**
   * 未検証の値（マスタ JSON の文字列など）から期間を作る。
   * @param start 開始日の候補（'YYYY-MM-DD'）
   * @param end 終了日の候補（'YYYY-MM-DD'）
   * @returns 成功: Period。失敗: INVALID_INPUT（書式不正・開始が終了より後）
   */
  static fromUnknown(start: unknown, end: unknown): Result<Period> {
    const log = logger.fn('fromUnknown');
    const startDate = parseLocalDate(start);
    const endDate = parseLocalDate(end);
    if (!startDate.ok) return log.fail(startDate);
    if (!endDate.ok) return log.fail(endDate);
    return log.exit(Period.of(startDate.value, endDate.value));
  }

  /**
   * その日が期間内か判定する（開始日・終了日を含む）。
   * @param date 判定する暦日
   * @returns 期間内なら true
   */
  contains(date: LocalDate): boolean {
    return compareLocalDate(this.start, date) <= 0 && compareLocalDate(date, this.end) <= 0;
  }

  /**
   * 終了日まであと何日かを返す（当日終了なら 0、終了後は負）。
   * @param date 基準の暦日（通常は今日）
   * @returns 終了日 − date の日数
   */
  daysUntilEnd(date: LocalDate): number {
    return daysBetween(date, this.end);
  }

  /**
   * まだ始まっていないか判定する。
   * @param date 判定する暦日
   * @returns 開始日より前なら true
   */
  hasNotStarted(date: LocalDate): boolean {
    return compareLocalDate(date, this.start) < 0;
  }

  /**
   * 保存・DTO 用のプレーンな形にする。
   * @returns { start, end }
   */
  toJSON(): { readonly start: LocalDate; readonly end: LocalDate } {
    return { start: this.start, end: this.end };
  }
}
