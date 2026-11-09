/**
 * @file 回数制限（infrastructure/server/http 層。固定の時間枠ごとに数える。SEC-18）
 * 相手（IP アドレス）ごとに、時間枠の中で受け付けた回数を数え、上限を超えたら断る。
 * 覚える相手の数にも上限を置き、古い枠から捨てる（大量の相手で記憶を使い切らない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { systemNowMs } from '@/infrastructure/time/SystemClock';

const logger = createLogger('infrastructure/server/http/FixedWindowRateLimiter');

/** 回数制限の設定 */
export interface RateLimitOptions {
  /** 1つの時間枠で受け付ける回数 */
  readonly limit: number;
  /** 時間枠の長さ（ミリ秒） */
  readonly windowMs: number;
  /** 覚える相手の数の上限 */
  readonly maxKeys?: number;
  /** 実時刻（エポックミリ秒）。テストで固定する */
  readonly nowMs?: () => number;
}

/** 覚える相手の数の既定 */
const DEFAULT_MAX_KEYS = 10_000;

/** 固定の時間枠ごとの回数制限 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  /**
   * 回数制限を作る。
   * @param options 回数・時間枠
   */
  constructor(private readonly options: RateLimitOptions) {}

  /**
   * 1回分を使う。
   * @param key 相手の識別子
   * @returns 受け付けてよければ true（上限を超えたら false）
   * @sideEffect 回数を数える。覚える数が上限を超えたら古いものを捨てる
   */
  tryTake(key: string): boolean {
    const log = logger.fn('tryTake');
    const now = (this.options.nowMs ?? systemNowMs)();
    const current = this.windows.get(key);
    if (current === undefined || now - current.start >= this.options.windowMs) {
      this.windows.delete(key);
      this.windows.set(key, { start: now, count: 1 });
      this.forgetOldest();
      return log.exit(true);
    }
    current.count += 1;
    return log.exit(current.count <= this.options.limit, `count=${current.count}`);
  }

  /**
   * 覚える数が上限を超えたら、古い順に捨てる（Map は入れた順に並ぶ）。
   * @sideEffect 記憶を減らす
   */
  private forgetOldest(): void {
    const log = logger.fn('forgetOldest', { size: this.windows.size });
    const max = this.options.maxKeys ?? DEFAULT_MAX_KEYS;
    for (const key of this.windows.keys()) {
      if (this.windows.size <= max) break;
      this.windows.delete(key);
    }
    log.exit(undefined);
  }
}
