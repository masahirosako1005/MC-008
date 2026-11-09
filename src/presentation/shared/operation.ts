/**
 * @file 操作ID の発行（presentation/shared 層）
 * 書込み系ユースケース（訪問・ライバル行動など）の入力 operationId を発行する（冪等性＝DI-07）。
 * crypto.randomUUID を使う（Math.random は使わない＝SEC-12）。使えない環境では crypto.getRandomValues で UUID v4 を組み立てる。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/shared/operation');

/**
 * 16 バイトの乱数から UUID v4 文字列を組み立てる（randomUUID が無い環境用）。
 * @param bytes 16 バイトの乱数（version・variant のビットはここで上書きする）
 * @returns 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'（小文字16進）
 */
export function uuidV4FromBytes(bytes: Uint8Array): string {
  const log = logger.fn('uuidV4FromBytes', { length: bytes.length });
  const b = Uint8Array.from({ length: 16 }, (_, i) => bytes[i] ?? 0);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return log.exit(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
}

/**
 * 新しい操作ID（UUID）を発行する。ボタン押下などの操作ごとに1回呼ぶ。
 * @returns UUID 文字列（OperationId の形式 ^[0-9a-f-]{8,64}$ を満たす）
 */
export function newOperationId(): string {
  const log = logger.fn('newOperationId');
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === 'function') return log.exit(cryptoApi.randomUUID());
  return log.exit(uuidV4FromBytes(cryptoApi.getRandomValues(new Uint8Array(16))));
}
