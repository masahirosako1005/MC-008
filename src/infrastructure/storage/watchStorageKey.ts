/**
 * @file 別タブによる localStorage の書き換えを監視する（infrastructure/storage 層）
 * ブラウザの storage イベントは「同じオリジンの別の文書」が書いたときだけ届く。店舗CMS（cms.html）で保存すると、
 * 隣のタブで開いている利用者アプリに届く（docs/09 §7.2）。window が無い環境（Vitest の node）では何もしない。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('infrastructure/storage/watchStorageKey');

/**
 * 指定したキーの書き換え（削除を含む）を監視する。
 * @param key 接頭辞つきの完全なキー（例: 'nnishi.demo.cms.overlay'）
 * @param onChange 書き換えられたときに呼ぶ関数
 * @returns 監視をやめる関数
 * @sideEffect window に storage イベントのリスナを登録する
 */
export function watchStorageKey(key: string, onChange: () => void): () => void {
  const log = logger.fn('watchStorageKey', { key });
  if (typeof window === 'undefined') return log.exit(() => undefined, 'noWindow');
  /** 対象のキー（またはストア全体の clear＝key が null）のときだけ知らせる */
  const listener = (event: StorageEvent): void => { // audit-ignore: fnlog-missing ストレージ書込みのたびに呼ばれる小さな振り分け
    if (event.key === key || event.key === null) onChange();
  };
  window.addEventListener('storage', listener);
  return log.exit(() => window.removeEventListener('storage', listener));
}
