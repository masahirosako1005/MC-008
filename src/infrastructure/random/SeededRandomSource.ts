/**
 * @file 種つきの再現可能な乱数源（infrastructure/random 層。RandomSource のデモ・テスト実装）
 * mulberry32 で、同じ種なら同じ数列を返す（発表を同じ流れで再現する＝docs/08 D13、DI-23）。暗号用途には使わない。
 */
import { createLogger } from '@/Common/logging/logger';
import type { RandomSource } from '@/domain/ports/RandomSource';

const logger = createLogger('infrastructure/random/SeededRandomSource');

/** 2^32（32bit 符号なし整数の個数） */
const UINT32_RANGE = 0x1_0000_0000;

/** mulberry32 の加算定数 */
const MULBERRY_INCREMENT = 0x6d2b79f5;

/** 種つきの再現可能な乱数源（mulberry32） */
export class SeededRandomSource implements RandomSource {
  private state: number;

  /**
   * 乱数源を作る。
   * @param seed 種（整数。32bit に切り詰める）
   */
  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /**
   * [0, 1) の乱数を返し、内部状態を進める。
   * @returns 0 以上 1 未満の数（同じ種なら同じ数列）
   * @sideEffect 内部状態を進める
   */
  next(): number {
    const log = logger.fn('next');
    this.state = (this.state + MULBERRY_INCREMENT) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return log.exit(((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE);
  }
}
