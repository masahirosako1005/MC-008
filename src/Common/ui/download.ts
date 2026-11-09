/**
 * @file 文字列をファイルとして端末に保存させる部品（Common/ui 層）
 * Blob の URL を作り、download 属性付きのリンクを押して保存ダイアログ（またはダウンロード）を出す。
 * URL は保存が始まった後に解放する。設定画面の「データを書き出す」（DI-21）で使う。中身はログに出さない（長さだけ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';

const logger = createLogger('Common/ui/download');

/** URL を解放するまでの待ち時間（クリック直後に解放すると保存が始まらないブラウザがある） */
const REVOKE_DELAY_MS = 1000;

/**
 * 文字列をファイルとして保存させる。
 * @param filename ファイル名（呼び出し側で作った安全な名前）
 * @param content 中身
 * @param mimeType MIME タイプ（'application/json' など）
 * @returns 保存を始められたら true（Blob・URL を作れない環境なら false）
 * @sideEffect 一時的なリンクを document に置いて押し、すぐ取り除く
 */
export function saveTextFile(filename: string, content: string, mimeType: string): boolean {
  const log = logger.fn('saveTextFile', { filename, length: content.length });
  try {
    const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
    const link = h('a', { class: 'visually-hidden', attrs: { href: url, download: filename } });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    return log.exit(true);
  } catch (error) {
    // 境界：古いブラウザや制限された環境で Blob・URL が使えないとき。画面には「保存できませんでした」を出す
    log.error('ファイルを保存できませんでした', { error });
    return log.exit(false);
  }
}
