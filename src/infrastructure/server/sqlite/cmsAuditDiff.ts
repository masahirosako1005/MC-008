/**
 * @file 登録内容の前と後から、変更履歴の項目を作る（infrastructure/server/sqlite 層。DI-20「いつ・誰が・何を（前の値と後の値）」）
 * スポットの編集はスポットID ごと、クーポン・イベントは ID ごとに比べる。純粋関数（時刻・操作者は呼び出し側が足す）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { CmsOverlayData } from '@/application/ports/CmsOverlayRepository';
import type { CmsAuditEntry } from '@/infrastructure/server/sqlite/CmsDatabase';

const logger = createLogger('infrastructure/server/sqlite/cmsAuditDiff');

/** 変更の中身（時刻・操作者・版番号を除いたもの） */
export type CmsAuditChange = Pick<CmsAuditEntry, 'action' | 'targetType' | 'targetId' | 'before' | 'after'>;

/**
 * キーの順に左右されない JSON 文字列を作る（同じ中身かどうかを比べるため）。
 * @param value 値
 * @returns 正規化した JSON 文字列
 */
export function stableJson(value: unknown): string { // audit-ignore: fnlog-missing 値ごとに再帰で多数回呼ぶ純粋なヘルパー（呼び出し元の pairsOf で記録する）
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * 2つの一覧を ID ごとに比べる。
 * @param before 前
 * @param after 後
 * @param idOf ID の取り出し方
 * @returns ID ごとの前と後（どちらかが無いものも含む。変わっていないものは除く）
 */
function pairsOf<T>(before: readonly T[], after: readonly T[], idOf: (item: T) => string): readonly { id: string; before?: T; after?: T }[] {
  const log = logger.fn('pairsOf', { before: before.length, after: after.length });
  const old = new Map(before.map((item) => [idOf(item), item]));
  const now = new Map(after.map((item) => [idOf(item), item]));
  const ids = [...new Set([...old.keys(), ...now.keys()])];
  const pairs = ids
    .map((id) => ({ id, before: old.get(id), after: now.get(id) }))
    .filter((p) => p.before === undefined || p.after === undefined || stableJson(p.before) !== stableJson(p.after));
  return log.exit(pairs.map((p) => ({ id: p.id, ...(p.before === undefined ? {} : { before: p.before }), ...(p.after === undefined ? {} : { after: p.after }) })));
}

/**
 * 前と後の有無から、操作の名前を決める。
 * @param kind 対象の種類
 * @param pair 前と後
 * @returns 例 'spotEdit.create'
 */
function actionOf(kind: 'spotEdit' | 'shopEvent', pair: { readonly before?: object; readonly after?: object }): string {
  const log = logger.fn('actionOf', { kind });
  if (pair.before === undefined) return log.exit(kind === 'shopEvent' ? 'shopEvent.register' : 'spotEdit.create');
  if (pair.after === undefined) return log.exit(`${kind}.delete`);
  const withdrawn = kind === 'shopEvent' && Reflect.get(pair.before, 'withdrawnOn') === undefined && Reflect.get(pair.after, 'withdrawnOn') !== undefined;
  return log.exit(withdrawn ? 'shopEvent.withdraw' : `${kind}.update`);
}

/**
 * 登録内容の前と後から、変更履歴の項目を作る（処理済みの操作ID の変化は記録しない）。
 * @param before 前の登録内容
 * @param after 後の登録内容
 * @returns 変更の一覧（スポットの編集 → クーポン・イベント の順）
 */
export function diffCmsOverlay(before: CmsOverlayData, after: CmsOverlayData): readonly CmsAuditChange[] {
  const log = logger.fn('diffCmsOverlay');
  const edits = pairsOf(before.spotEdits, after.spotEdits, (e) => e.spotId).map((p): CmsAuditChange => ({
    action: actionOf('spotEdit', p), targetType: 'spot', targetId: p.id, ...(p.before ? { before: p.before } : {}), ...(p.after ? { after: p.after } : {}),
  }));
  const events = pairsOf(before.shopEvents, after.shopEvents, (e) => e.id).map((p): CmsAuditChange => ({
    action: actionOf('shopEvent', p), targetType: 'shopEvent', targetId: p.id, ...(p.before ? { before: p.before } : {}), ...(p.after ? { after: p.after } : {}),
  }));
  return log.exit([...edits, ...events], `changes=${edits.length + events.length}`);
}
