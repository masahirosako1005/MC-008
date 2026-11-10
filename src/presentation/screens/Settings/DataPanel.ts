/**
 * @file 設定画面の「データ」のまとまり（presentation/screens/Settings 層）
 * - データを書き出す: 端末に保存した利用者のデータを JSON ファイルにして保存させる（DI-21）
 * - 読み込む: 書き出したファイルを選び、確認ダイアログで「置き換える」を押したときだけ端末のデータを置き換えて、アプリを読み込み直す（DI-21 復元）
 * - すべてのデータを削除: 確認ダイアログで「削除する」を押したときだけ消し、アプリを最初から読み込み直す（PRV-05、DI-22 物理削除）
 * 確認ダイアログは最初に「やめる」にフォーカスを置く（Enter の押し間違いで消さない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { saveTextFile } from '@/Common/ui/download';
import { openModal } from '@/Common/ui/Modal';
import type { ModalHandle } from '@/Common/ui/Modal';
import type { AppContext } from '@/presentation/App/AppContext';
import { DATA_TEXTS, deleteConfirmText } from '@/presentation/screens/Settings/settingsModel';

const logger = createLogger('presentation/screens/Settings/DataPanel');

/** 書き出しファイルの MIME タイプ */
const EXPORT_MIME = 'application/json';

/** 読み込むファイルの大きさの上限（バイト。仮）。中身の検証はユースケースが行う（ImportDataUseCase） */
const IMPORT_MAX_BYTES = 8 * 1024 * 1024;

/** 開いている確認ダイアログ（画面を離れるときに閉じる。無ければ undefined） */
let openConfirm: ModalHandle | undefined;

/**
 * 開いている確認ダイアログを閉じる（設定画面を離れるとき。確認の層を次の画面に残さない）。
 * @sideEffect モーダルを閉じる
 */
export function closeDataConfirm(): void {
  const log = logger.fn('closeDataConfirm', { open: openConfirm !== undefined });
  openConfirm?.close();
  openConfirm = undefined;
  log.exit(undefined);
}

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
 * 選んだファイルの中身で端末のデータを置き換え、成功したらアプリを最初から読み込み直す。失敗したらトーストで知らせる（データは元のまま）。
 * @param ctx 画面コンテキスト
 * @param content ファイルの中身
 * @sideEffect importData を呼び、成功ならページを読み込み直す
 */
async function importData(ctx: AppContext, content: string): Promise<void> {
  const log = logger.fn('importData', { length: content.length });
  const result = await ctx.services.importData.execute({ content, confirmed: true });
  if (!result.ok) {
    ctx.toast.show(result.error.code === 'INVALID_INPUT' ? DATA_TEXTS.importRejected : DATA_TEXTS.importFailed, { kind: 'error' });
    return log.fail(undefined, result.error.code);
  }
  log.exit(undefined, `written=${result.value.written}`);
  ctx.router.restart('#/map');
}

/**
 * 読み込みの確認ダイアログを開く（最初のフォーカスは「やめる」）。
 * @param ctx 画面コンテキスト
 * @param content ファイルの中身
 * @sideEffect モーダルを開く
 */
function confirmImport(ctx: AppContext, content: string): void {
  const log = logger.fn('confirmImport', { length: content.length });
  openConfirm?.close();
  openConfirm = openModal({
    title: DATA_TEXTS.importConfirmTitle,
    body: DATA_TEXTS.importConfirmBody,
    testId: 'settings-import-confirm',
    actions: [
      { label: DATA_TEXTS.confirmCancel, variant: 'secondary', testId: 'settings-import-cancel', onClick: (): void => undefined },
      { label: DATA_TEXTS.importConfirmOk, variant: 'primary', testId: 'settings-import-ok', onClick: (): void => void importData(ctx, content) },
    ],
  });
  log.exit(undefined);
}

/**
 * 選ばれたファイルを読み、確認ダイアログへ進む。大きすぎる・読めないファイルはトーストで断る。
 * @param ctx 画面コンテキスト
 * @param input ファイルの入力欄（読んだら空に戻し、同じファイルをもう一度選べるようにする）
 * @sideEffect ファイルを読み、モーダルかトーストを出す
 */
function readPickedFile(ctx: AppContext, input: HTMLInputElement): void {
  const log = logger.fn('readPickedFile');
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined) return log.exit(undefined, '未選択');
  if (file.size > IMPORT_MAX_BYTES) {
    ctx.toast.show(DATA_TEXTS.importRejected, { kind: 'error' });
    return log.exit(undefined, '大きすぎる');
  }
  void file.text().then(
    (content) => confirmImport(ctx, content),
    () => ctx.toast.show(DATA_TEXTS.importRejected, { kind: 'error' }),
  );
  log.exit(undefined);
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
  openConfirm?.close();
  openConfirm = openModal({
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
  const deleteButton = createButton({ label: DATA_TEXTS.deleteButton, variant: 'secondary', testId: 'settings-delete', onClick: (): void => confirmDelete(ctx) });
  deleteButton.classList.add('settings-danger');
  const picker = h('input', { class: 'visually-hidden', attrs: { type: 'file', accept: 'application/json,.json', tabindex: '-1', 'aria-hidden': 'true', 'data-testid': 'settings-import-file' } });
  picker.addEventListener('change', () => readPickedFile(ctx, picker));
  const importButton = createButton({ label: DATA_TEXTS.importButton, variant: 'secondary', testId: 'settings-import', onClick: (): void => picker.click() });
  return log.exit([h('div', { class: 'settings-action' }, [exportButton, importButton, deleteButton]), picker]);
}
