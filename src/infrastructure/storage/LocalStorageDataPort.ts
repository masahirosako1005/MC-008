/**
 * @file 利用者のデータ全体の localStorage 実装（infrastructure/storage 層。DataPort の実装）
 * 範囲は「接頭辞 P で始まるキー」から次を除いたもの（許可リストではなく除外リストにして、画面が後から足したキー＝地図の好みなども漏れなく消す）:
 * - P+'cms.*'（店舗CMS の登録内容。お店側のデータで、利用者の個人データではない＝docs/09）
 * - 別の名前空間（本番 'nnishi.' から見た 'nnishi.demo.*'。DI-23 デモと本番の分離）
 * - 開発用の debug フラグ（'nnishi.debug'）
 * デモの日付のずらし（'nnishi.demo.clockOffsetDays'）はデモの名前空間にあるので含める（削除すると今日に戻る）。
 * 削除は物理削除（DI-22）。1件でも消せなければ残りも試してから STORAGE_FAILED を返す。
 */
import { DEBUG_FLAG_STORAGE_KEY } from '@/Common/constants/env';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { DataPort, UserDataEntry } from '@/application/ports/DataPort';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';
import type { KeyValueStore } from '@/infrastructure/storage/KeyValueStore';

const logger = createLogger('infrastructure/storage/LocalStorageDataPort');

/** 店舗CMS のキーの区切り（storageKeys の CMS_OVERLAY_KEY = 'cms.overlay' など。お店側のデータなので範囲外） */
export const STORE_SIDE_SEGMENT = 'cms.';

/** ほかのビルドの名前空間（自分の接頭辞より長く、自分の接頭辞で始まるもの） */
const KNOWN_NAMESPACES: readonly string[] = ['nnishi.demo.', 'nnishi.'];

/** LocalStorageDataPort の依存 */
export interface LocalStorageDataPortDeps {
  readonly store: KeyValueStore;
  /** 保存キーの接頭辞（STORAGE_PREFIX。デモ 'nnishi.demo.'／本番 'nnishi.'） */
  readonly prefix: string;
}

/**
 * キーが利用者のデータの範囲に入るか判定する（純粋関数）。
 * @param key 完全なキー
 * @param prefix このビルドの接頭辞
 * @returns 範囲内なら true
 */
export function isUserDataKey(key: string, prefix: string): boolean {
  const log = logger.fn('isUserDataKey', { prefix });
  if (!key.startsWith(prefix) || key === DEBUG_FLAG_STORAGE_KEY) return log.exit(false);
  if (key.startsWith(`${prefix}${STORE_SIDE_SEGMENT}`)) return log.exit(false);
  const other = KNOWN_NAMESPACES.some((ns) => ns !== prefix && ns.length > prefix.length && ns.startsWith(prefix) && key.startsWith(ns));
  return log.exit(!other);
}

/** 利用者のデータ全体の localStorage 実装 */
export class LocalStorageDataPort implements DataPort {
  /**
   * 実装を作る。
   * @param deps キー・値ストアと接頭辞
   */
  constructor(private readonly deps: LocalStorageDataPortDeps) {}

  /**
   * 範囲内のキーを昇順で返す。
   * @returns 成功: 完全なキーの一覧。失敗: STORAGE_FAILED
   */
  private userKeys(): Result<string[]> {
    const log = logger.fn('userKeys', { prefix: this.deps.prefix });
    const keys = this.deps.store.keys(this.deps.prefix);
    if (!keys.ok) return log.fail(keys);
    return log.exit(ok(keys.value.filter((key) => isUserDataKey(key, this.deps.prefix))));
  }

  /**
   * 範囲内のデータをすべて読む（JSON として読めない値は元の文字列のまま返す。中身はログに出さない）。
   * @returns 成功: キー（接頭辞を除く）と値の一覧。失敗: STORAGE_FAILED
   */
  async readAll(): Promise<Result<readonly UserDataEntry[]>> {
    const log = logger.fn('readAll');
    const keys = this.userKeys();
    if (!keys.ok) return log.fail(keys);
    const entries: UserDataEntry[] = [];
    for (const key of keys.value) {
      const raw = this.deps.store.get(key);
      if (!raw.ok) return log.fail(raw);
      if (raw.value === undefined) continue;
      const parsed = parseJsonText(raw.value, 'userData');
      entries.push({ key: key.slice(this.deps.prefix.length), value: parsed.ok ? parsed.value : raw.value });
    }
    return log.exit(ok(entries), `count=${entries.length}`);
  }

  /**
   * 範囲内のデータをすべて消す。
   * @returns 成功: 消した件数。失敗: STORAGE_FAILED（details に消せた件数と消せなかった件数）
   * @sideEffect localStorage のキーを消す
   */
  async deleteAll(): Promise<Result<{ readonly removed: number }>> {
    const log = logger.fn('deleteAll');
    const keys = this.userKeys();
    if (!keys.ok) return log.fail(keys);
    let removed = 0;
    let failed = 0;
    for (const key of keys.value) {
      if (this.deps.store.remove(key).ok) removed += 1;
      else failed += 1;
    }
    if (failed > 0) return log.fail(fail(AppError.of('STORAGE_FAILED', '一部のデータを削除できませんでした', { removed, failed })));
    return log.exit(ok({ removed }));
  }
}
