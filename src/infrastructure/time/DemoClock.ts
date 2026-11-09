/**
 * @file デモ用の時計（infrastructure/time 層。Clock のデモ実装）
 * 実時刻 + offsetDays 日。offset はデモ専用キー（DEMO_CLOCK_OFFSET_STORAGE_KEY = 'nnishi.demo.clockOffsetDays'）に保存し、
 * 再読込しても同じ日付で続きを見せられるようにする（docs/08 D13）。本番の時計（SystemClock）と保存先を共有しない（DI-23）。
 * 今日は JST 暦日（DI-04）。日付進行は「戻せない」操作ではなく、旅人切替・resetOffset で 0 に戻る。
 */
import { DEMO_CLOCK_OFFSET_STORAGE_KEY } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { instantFromEpochMs, localDateOf, MS_PER_DAY } from '@/Common/utils/date';
import type { Instant, LocalDate } from '@/Common/utils/date';
import type { Clock } from '@/domain/ports/Clock';
import type { KeyValueStore } from '@/infrastructure/storage/KeyValueStore';
import { MAX_DEMO_OFFSET_DAYS, parseDemoOffsetDays } from '@/infrastructure/storage/schema/parsers';
import { systemNowMs } from '@/infrastructure/time/SystemClock';

const logger = createLogger('infrastructure/time/DemoClock');

/** 1回の日付進行で進められる最大日数 */
export const MAX_ADVANCE_DAYS = 365;

/** DemoClock の依存 */
export interface DemoClockDeps {
  /** offset の保存先 */
  readonly store: KeyValueStore;
  /** 実時刻（エポックミリ秒）を返す関数（省略時は Date.now。テストで固定値を渡す） */
  readonly nowMs?: () => number;
  /** offset の保存キー（省略時は DEMO_CLOCK_OFFSET_STORAGE_KEY） */
  readonly storageKey?: string;
}

/** デモ用の時計（実時刻 + offsetDays 日） */
export class DemoClock implements Clock {
  private cachedOffset: number | undefined;

  /**
   * 時計を作る。offset は最初に使うときに読み込む。
   * @param deps 保存先・実時刻・保存キー
   */
  constructor(private readonly deps: DemoClockDeps) {}

  /** offset の保存キー */
  private get storageKey(): string {
    return this.deps.storageKey ?? DEMO_CLOCK_OFFSET_STORAGE_KEY;
  }

  /**
   * 保存された offset を読む。読めない・壊れている場合は 0 とみなして warn を残す（時計は失敗を返せないため）。
   * @returns offset（日）
   */
  private loadOffset(): number {
    const log = logger.fn('loadOffset');
    const stored = this.deps.store.get(this.storageKey);
    if (!stored.ok) {
      log.warn('デモ日付のずらし日数を読めないため 0 とみなします');
      return log.exit(0);
    }
    if (stored.value === undefined) return log.exit(0);
    const parsed = parseDemoOffsetDays(stored.value);
    if (!parsed.ok) {
      log.warn('デモ日付のずらし日数が壊れているため 0 とみなします');
      return log.exit(0);
    }
    return log.exit(parsed.value);
  }

  /**
   * 実時刻からのずらし日数を返す。
   * @returns offset（0 以上の整数）
   */
  offsetDays(): number {
    const log = logger.fn('offsetDays');
    if (this.cachedOffset === undefined) this.cachedOffset = this.loadOffset();
    return log.exit(this.cachedOffset);
  }

  /**
   * 現在の瞬間（実時刻 + offset 日）を返す。
   * @returns Instant
   */
  now(): Instant {
    const log = logger.fn('now');
    const nowMs = this.deps.nowMs ?? systemNowMs;
    return log.exit(instantFromEpochMs(nowMs() + this.offsetDays() * MS_PER_DAY));
  }

  /**
   * 今日（JST 暦日）を返す。
   * @returns 'YYYY-MM-DD'
   */
  today(): LocalDate {
    const log = logger.fn('today');
    return log.exit(localDateOf(this.now()));
  }

  /**
   * 日付を days 日進め、offset を保存する。
   * @param days 進める日数（1〜MAX_ADVANCE_DAYS の整数）
   * @returns 成功: 新しい offset。失敗: INVALID_INPUT（日数が不正・上限超え）/ STORAGE_FAILED（保存できない。offset は変えない）
   * @sideEffect offset を保存する
   */
  advanceDays(days: number): Result<number> {
    const log = logger.fn('advanceDays', { days });
    if (!Number.isSafeInteger(days) || days < 1 || days > MAX_ADVANCE_DAYS) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '進める日数が正しくありません', { days })));
    }
    const next = this.offsetDays() + days;
    if (next > MAX_DEMO_OFFSET_DAYS) {
      return log.fail(fail(AppError.of('INVALID_INPUT', 'これ以上日付を進められません', { next })));
    }
    const saved = this.deps.store.set(this.storageKey, String(next));
    if (!saved.ok) return log.fail(saved);
    this.cachedOffset = next;
    log.warn('デモ日付を進めました', { days, offsetDays: next });
    return log.exit(ok(next));
  }

  /**
   * offset を 0 に戻す（旅人切替で使う）。
   * @returns 成功: void。失敗: STORAGE_FAILED（offset は変えない）
   * @sideEffect 保存した offset を消す
   */
  resetOffset(): Result<void> {
    const log = logger.fn('resetOffset');
    const removed = this.deps.store.remove(this.storageKey);
    if (!removed.ok) return log.fail(removed);
    this.cachedOffset = 0;
    log.warn('デモ日付を実時刻に戻しました');
    return log.exit(okVoid());
  }
}
