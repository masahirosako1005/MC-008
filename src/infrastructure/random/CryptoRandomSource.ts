/**
 * @file 暗号論的乱数の乱数源（infrastructure/random 層。RandomSource の本番実装）
 * crypto.getRandomValues の 32bit 整数を [0, 1) に写す。Math.random は使わない（SEC-12）。
 */
import { createLogger } from '@/Common/logging/logger';
import { invariant } from '@/Common/utils/assert';
import type { RandomSource } from '@/domain/ports/RandomSource';

const logger = createLogger('infrastructure/random/CryptoRandomSource');

/** 2^32（32bit 符号なし整数の個数） */
const UINT32_RANGE = 0x1_0000_0000;

/** 暗号論的乱数の乱数源 */
export class CryptoRandomSource implements RandomSource {
  /**
   * [0, 1) の一様乱数を返す。
   * @returns 0 以上 1 未満の数
   * @throws Error crypto.getRandomValues が使えない環境
   */
  next(): number {
    const log = logger.fn('next');
    invariant(typeof globalThis.crypto?.getRandomValues === 'function', 'crypto.getRandomValues が使えません');
    const values = globalThis.crypto.getRandomValues(new Uint32Array(1));
    return log.exit((values[0] ?? 0) / UINT32_RANGE);
  }
}
