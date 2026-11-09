/**
 * @file 暗号論的乱数による ID 発行（infrastructure/random 層。IdGenerator の実装）
 * crypto.randomUUID でハイフンを除いた小文字32桁を作り、接頭辞を付ける（推測されにくい ID＝SEC-12）。
 * 例: newId('ev') → 'ev_0f8fad5bd9cb469fa16570867728950e'（EventId の正規表現 ^ev_[0-9a-z]{4,64}$ を満たす）。
 */
import { createLogger } from '@/Common/logging/logger';
import { invariant } from '@/Common/utils/assert';
import type { IdGenerator } from '@/domain/ports/IdGenerator';

const logger = createLogger('infrastructure/random/CryptoIdGenerator');

/** 接頭辞の書式（英小文字 1〜8 字） */
const PREFIX_PATTERN = /^[a-z]{1,8}$/;

/** UUID の書式（crypto.randomUUID の出力） */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * UUID（v4）を作る。操作ID（OperationId）や本番の旅人ID（travelerIdFromUuid）の元にする。
 * @returns 小文字の UUID 文字列（例: '0f8fad5b-d9cb-469f-a165-70867728950e'）
 * @throws Error crypto.randomUUID が使えない環境（安全でない文脈など。起動時に気づけるよう例外にする）
 */
export function uuid(): string {
  const log = logger.fn('uuid');
  invariant(typeof globalThis.crypto?.randomUUID === 'function', 'crypto.randomUUID が使えません');
  return log.exit(globalThis.crypto.randomUUID().toLowerCase());
}

/** 暗号論的乱数による ID 発行 */
export class CryptoIdGenerator implements IdGenerator {
  /**
   * ID 発行を作る。
   * @param newUuid UUID を作る関数（省略時は uuid。テストで固定値を渡す）
   */
  constructor(private readonly newUuid: () => string = uuid) {}

  /**
   * 接頭辞つきの新しい ID を返す。
   * @param prefix 英小文字 1〜8 字の接頭辞（例: 'ev', 't'）
   * @returns prefix + '_' + ハイフンを除いた小文字32桁
   * @throws Error 接頭辞・UUID の書式が不正（呼び出し側のバグ）
   */
  newId(prefix: string): string {
    const log = logger.fn('newId', { prefix });
    invariant(PREFIX_PATTERN.test(prefix), 'CryptoIdGenerator.newId: 接頭辞は英小文字 1〜8 字');
    const raw = this.newUuid().toLowerCase();
    invariant(UUID_PATTERN.test(raw), 'CryptoIdGenerator.newId: UUID の書式が不正');
    return log.exit(`${prefix}_${raw.replace(/-/g, '')}`);
  }
}
