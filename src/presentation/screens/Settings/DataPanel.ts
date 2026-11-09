/**
 * @file 設定画面の「データ」のまとまり（presentation/screens/Settings 層）
 * - データを書き出す: 端末に保存した利用者のデータを JSON ファイルにして保存させる（DI-21）
 * - すべてのデータを削除: 確認ダイアログで「削除する」を押したときだけ消し、アプリを最初から読み込み直す（PRV-05、DI-22 物理削除）
 * 確認ダイアログは最初に「やめる」にフォーカスを置く（Enter の押し間違いで消さない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { saveTextFile } from '@/Common/ui/download';
import { openModal } from '@/Common/ui/Modal';
import type { AppContext } from '@/presentation/App/AppContext';
import { DATA_TEXTS, deleteConfirmText } from '@/presentation/screens/Settings/settingsModel';

const logger = createLogger('presentation/screens/Settings/DataPanel');

/** 書き出しファイルの MIME タイプ */
const EXPORT_MIME = 'application/json';

/**
 * データを書き出して、ファイルとして保存させる。結果はトーストで知らせる。
 * @param ctx 画面コンテキスト
 * @sideEffect exportData を呼び、ファイルの保存を始め、トーストを出す
 */
async function exportData(ctx: AppContext): Promise<void> {
  const log = logger.fn('exportData');
  const result = await ctx.services.exportData.execute();
  if (!result.ok) {
    ctx.toast.show(DATA_TEXTS.exportFailed, { kind: 'error' });
    return log.fail(undefined, result.error.code);
  }
  const saved = saveTextFile(result.value.filename, result.value.content, EXPORT_MIME);
  ctx.toast.show(saved ? DATA_TEXTS.exported(result.value.entryCount) : DATA_TEXTS.exportFailed, { kind: saved ? 'info' : 'error' });
  log.exit(undefined, saved ? undefined : '保存を始められなかった');
}

/**
 * すべてのデータを消し、成功したらアプリを最初から読み込み直す。失敗したらトーストで知らせる（一部が残っていても読み込み直さない）。
 * @param ctx 画面コンテキスト
 * @sideEffect deleteAllData を呼び、成功ならページを読み込み直す
 */
async function deleteAllData(ctx: AppContext): Promise<void> {
  const log = logger.fn('deleteAllData');
  const result = await ctx.services.deleteAllData.execute({ confirmed: true });
  if (!result.ok) {
    ctx.toast.show(DATA_TEXTS.deleteFailed, { kind: 'error' });
    return log.fail(undefined, result.error.code);
  }
  log.exit(undefined, `removed=${result.value.removed}`);
  ctx.router.restart('#/map');
}

/**
 * 削除の確認ダイアログを開く。
 * @param ctx 画面コンテキスト
 * @sideEffect モーダルを開く
 */
function confirmDelete(ctx: AppContext): void {
  const log = logger.fn('confirmDelete');
  openModal({
    title: DATA_TEXTS.confirmTitle,
    body: deleteConfirmText(ctx.services.isDemo),
    testId: 'settings-delete-confirm',
    actions: [
      { label: DATA_TEXTS.confirmCancel, variant: 'secondary', testId: 'settings-delete-cancel', onClick: (): void => undefined },
      { label: DATA_TEXTS.confirmDelete, variant: 'primary', testId: 'settings-delete-ok', onClick: (): void => void deleteAllData(ctx) },
    ],
  });
  log.exit(undefined);
}

/**
 * 「データ」のカードの中身（書き出し・削除）を作る。
 * @param ctx 画面コンテキスト
 * @returns カードに入れる要素の並び
 */
export function createDataPanelItems(ctx: AppContext): HTMLElement[] {
  const log = logger.fn('createDataPanelItems');
  const exportButton = createButton({ label: DATA_TEXTS.exportButton, variant: 'secondary', testId: 'settings-export', onClick: (): Promise<void> => exportData(ctx) });
  const deleteButton = createButton({ label: DATA_TEXTS.deleteButton, variant: 'ghost', testId: 'settings-delete', onClick: (): void => confirmDelete(ctx) });
  deleteButton.classList.add('settings-danger');
  return log.exit([
    h('div', { class: 'settings-action' }, [h('p', { class: 'settings-action__lead', text: DATA_TEXTS.exportLead }), exportButton]),
    h('div', { class: 'settings-action' }, [h('p', { class: 'settings-action__lead', text: DATA_TEXTS.deleteLead }), deleteButton]),
  ]);
}
