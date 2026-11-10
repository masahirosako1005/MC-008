/**
 * @file ログインの失敗を数えてロックする（infrastructure/server/auth 層。CMS-A06、SEC-18）
 * 鍵は「ログインID＋相手（IP）」。同じ相手からの失敗が続いたときだけロックし、ほかの相手（本人）には影響しない
 * （誰かが運営者の ID を5回まちがえて本人を締め出す、という使い方をさせない）。知らない ID でも同じように数える（ID の有無を漏らさない）。
 * メモリの中で同期的に数えるので、並行して届いた失敗が数え漏れない（DB の読み書きの間に別の要求が入る問題を避ける）。
 * 連携サーバーは1プロセスなので、メモリで足りる。覚える鍵の数にも上限を置く（SEC-18）。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('infrastructure/server/auth/LoginThrottle');

/** 設定 */
export interface LoginThrottleOptions {
  /** この回数の失敗が続いたらロックする */
  readonly maxFailures: number;
  /** ロックの長さ（ミリ秒）。失敗を数える窓の長さでもある */
  readonly lockMs: number;
  /** 実時刻（エポックミリ秒） */
  readonly nowMs: () => number;
  /** 覚える鍵の数の上限 */
  readonly maxKeys?: number;
}

/** 1つの鍵の状態 */
interface Entry {
  failures: number;
  /** 最初の失敗の時刻 */
  firstAt: number;
  /** ロックが解ける時刻（ロックしていなければ 0） */
  lockedUntil: number;
}

/** 失敗の結果 */
export interface FailureOutcome {
  readonly failures: number;
  readonly locked: boolean;
}

/** 覚える鍵の数の既定 */
const DEFAULT_MAX_KEYS = 20_000;

/** ログインの失敗の数え方 */
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  /**
   * 数え方を作る。
   * @param options 回数・長さ・時計
   */
  constructor(private readonly options: LoginThrottleOptions) {}

  /**
   * 鍵を作る（ログインID と相手）。
   * @param loginId 正規化したログインID（知らない ID でもよい）
   * @param clientKey 相手の識別子
   * @returns 鍵
   */
  static keyOf(loginId: string, clientKey: string): string {
    return `${loginId}\u0000${clientKey}`;
  }

  /**
   * 生きている状態を読む（窓を過ぎたものは忘れる）。
   * @param key 鍵
   * @param now 今
   * @returns 状態（無ければ undefined）
   */
  private alive(key: string, now: number): Entry | undefined { // audit-ignore: fnlog-missing 要求ごとに呼ぶ小さな読み出し（呼び出し元が記録する）
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.lockedUntil > now) return entry;
    if (now - entry.firstAt >= this.options.lockMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /**
   * いまロック中か。
   * @param key 鍵
   * @returns ロック中なら true
   */
  isLocked(key: string): boolean {
    const log = logger.fn('isLocked');
    const entry = this.alive(key, this.options.nowMs());
    return log.exit(entry !== undefined && entry.lockedUntil > this.options.nowMs());
  }

  /**
   * 失敗を1回数える（上限に達したらロックする）。
   * @param key 鍵
   * @returns 失敗の回数と、ロックしたか
   * @sideEffect 状態を書き換える。覚える数が上限を超えたら古いものを捨てる
   */
  recordFailure(key: string): FailureOutcome {
    const log = logger.fn('recordFailure');
    const now = this.options.nowMs();
    const entry = this.alive(key, now) ?? { failures: 0, firstAt: now, lockedUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= this.options.maxFailures) entry.lockedUntil = now + this.options.lockMs;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.forgetOldest();
    return log.exit({ failures: entry.failures, locked: entry.lockedUntil > now }, `failures=${entry.failures}`);
  }

  /**
   * 成功したので忘れる。
   * @param key 鍵
   * @sideEffect 状態を消す
   */
  clear(key: string): void {
    this.entries.delete(key);
  }

  /**
   * そのログインID に、相手を問わずロック中のものがあるか（運営者の一覧の表示用）。
   * @param loginId 正規化したログインID
   * @returns あれば true
   */
  hasLockFor(loginId: string): boolean {
    const log = logger.fn('hasLockFor');
    const now = this.options.nowMs();
    const prefix = `${loginId}\u0000`;
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix) && entry.lockedUntil > now) return log.exit(true);
    }
    return log.exit(false);
  }

  /**
   * 覚える数が上限を超えたら、古い順に捨てる（Map は入れた順に並ぶ）。
   * @sideEffect 記憶を減らす
   */
  private forgetOldest(): void { // audit-ignore: fnlog-missing 失敗のたびに呼ぶ小さな掃除（recordFailure で記録する）
    const max = this.options.maxKeys ?? DEFAULT_MAX_KEYS;
    for (const key of this.entries.keys()) {
      if (this.entries.size <= max) break;
      this.entries.delete(key);
    }
  }
}
