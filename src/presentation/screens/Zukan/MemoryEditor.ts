/**
 * @file 思い出の編集（presentation/screens/Zukan 層）
 * 記録の1件を押すと開く。その回の写真（自分の写真。無ければスポットの写真）を大きく見せ、写真の差し替え・削除とメモの入力ができる。基準 C。
 * 写真は端末で選び、縮小・再圧縮してから渡す（memoryPhoto。EXIF は残らない＝PRV-03）。保存は「保存」を押したときだけ。
 * 文字は最小限（説明文は出さない）。メモ・写真の中身はログに出さない。
 */
import type { SaveVisitMemoryInput, VisitLogEntryDto } from '@/application/dto/VisitLogDto';
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import { openModal } from '@/Common/ui/Modal';
import type { ModalHandle } from '@/Common/ui/Modal';
import { userAction } from '@/Common/ui/userAction';
import { createImageBadge, createPhotoCredit, mountPhotoImage } from '@/presentation/screens/Spot/SpotPhotoView';
import { compressMemoryPhoto } from '@/presentation/screens/Zukan/memoryPhoto';
import { nthLabel } from '@/presentation/screens/Zukan/visitLogModel';
import { spotPhotoOf } from '@/presentation/shared/spotPhotos';

const logger = createLogger('presentation/screens/Zukan/MemoryEditor');

/** 写真を読めなかったときの文言 */
export const PHOTO_FAILED_TEXT = '写真を読み込めませんでした';

/** openMemoryEditor のオプション */
export interface MemoryEditorOptions {
  readonly entry: VisitLogEntryDto;
  /** メモの文字数の上限 */
  readonly noteMax: number;
  /** 写真（data URL）の文字数の上限 */
  readonly photoMaxChars: number;
  /** 「保存」が押されたとき（変えた項目だけを入れた入力） */
  readonly onSave: (input: SaveVisitMemoryInput) => void;
  /** 「スポット詳細」が押されたとき */
  readonly onOpenSpot: (spotId: string) => void;
  /** 写真を読めなかったとき */
  readonly onError: (message: string) => void;
}

/** 編集中の状態 */
interface EditorState {
  /** いま出している自分の写真（無ければ undefined） */
  photo: string | undefined;
  /** 写真を変えたか */
  photoChanged: boolean;
}

/**
 * 写真の枠の中身を描く（自分の写真。無ければスポットの写真＋クレジット）。
 * @param frame 写真の枠
 * @param credit クレジットの入れ先
 * @param entry 記録
 * @param photo 自分の写真（無ければ undefined）
 * @sideEffect frame と credit の中身を差し替える
 */
function paintPhoto(frame: HTMLElement, credit: HTMLElement, entry: VisitLogEntryDto, photo: string | undefined): void {
  const log = logger.fn('paintPhoto', { spotId: entry.spotId, mine: photo !== undefined });
  frame.replaceChildren();
  credit.replaceChildren();
  frame.dataset.mine = photo === undefined ? '0' : '1';
  if (photo !== undefined) {
    frame.append(h('img', { class: 'memory-editor__img', attrs: { src: photo, alt: `${entry.spotName}で撮った写真`, 'data-testid': 'memory-photo' } }));
    return log.exit(undefined, '自分の写真');
  }
  const spotPhoto = spotPhotoOf({ id: entry.spotId, kind: entry.kind, category: entry.category });
  if (spotPhoto === undefined) return log.exit(undefined, '写真なし');
  mountPhotoImage(frame, spotPhoto, { alt: spotPhoto.isImage ? `${entry.category}のイメージ写真` : `${entry.spotName}の写真`, onFail: (): void => credit.replaceChildren() });
  if (spotPhoto.isImage) frame.append(createImageBadge());
  credit.append(createPhotoCredit(spotPhoto));
  log.exit(undefined, 'スポットの写真');
}

/** 写真の部分（枠・クレジット・「写真」「写真を消す」のボタン）の操作 */
interface PhotoPart {
  readonly frame: HTMLElement;
  readonly credit: HTMLElement;
  /** 「写真」（選ぶ）と「写真を消す」 */
  readonly tools: readonly HTMLElement[];
  readonly state: EditorState;
}

/**
 * 写真の部分を作る。選んだ写真は縮小・再圧縮してから出す。読めなければ onError で知らせる。
 * @param opts 記録・写真の上限・失敗の処理
 * @returns 写真の部分
 * @sideEffect 写真を選ぶ・消すと、状態と写真の枠を書き換える
 */
function createPhotoPart(opts: MemoryEditorOptions): PhotoPart {
  const { entry } = opts;
  const log = logger.fn('createPhotoPart', { spotId: entry.spotId, mine: entry.photo !== undefined });
  const state: EditorState = { photo: entry.photo, photoChanged: false };
  const frame = h('div', { class: 'memory-editor__photo' });
  const credit = h('div', { class: 'memory-editor__credit' });
  /**
   * 写真を差し替えて描き直す。
   * @param photo 新しい写真（消すなら undefined）
   * @sideEffect 状態と写真の枠を書き換える
   */
  const setPhoto = (photo: string | undefined): void => {
    const setLog = logger.fn('setPhoto', { has: photo !== undefined });
    state.photo = photo;
    state.photoChanged = true;
    paintPhoto(frame, credit, entry, photo);
    removeButton.hidden = photo === undefined;
    setLog.exit(undefined);
  };
  const removeButton = createButton({ label: '写真を消す', variant: 'secondary', testId: 'memory-photo-remove', onClick: (): void => setPhoto(undefined) });
  const fileInput = h('input', { class: 'memory-editor__file', attrs: { type: 'file', accept: 'image/*', 'aria-label': '写真を選ぶ', 'data-testid': 'memory-photo-input' } });
  /**
   * 選ばれた写真を縮小・再圧縮して出す。読めなければ知らせる。
   * @sideEffect 状態と写真の枠を書き換える。失敗時は onError を呼ぶ
   */
  const pick = async (): Promise<void> => {
    const pickLog = logger.fn('pick', { files: fileInput.files?.length });
    const file = fileInput.files?.[0];
    if (file === undefined) return pickLog.exit(undefined, '未選択');
    const photo = await compressMemoryPhoto(file, opts.photoMaxChars);
    fileInput.value = '';
    if (photo === undefined) {
      opts.onError(PHOTO_FAILED_TEXT);
      return pickLog.fail(undefined, 'compress');
    }
    setPhoto(photo);
    pickLog.exit(undefined);
  };
  fileInput.addEventListener('change', userAction('memory-photo-pick', (): void => void pick()));
  const pickLabel = h('label', { class: ['btn', 'btn--secondary', 'memory-editor__pick'] }, [createIcon('camera'), h('span', { class: 'btn__label', text: '写真' }), fileInput]);
  paintPhoto(frame, credit, entry, state.photo);
  removeButton.hidden = state.photo === undefined;
  return log.exit({ frame, credit, tools: [pickLabel, removeButton], state });
}

/**
 * 変えた項目だけを入れた保存の入力を作る（何も変えていなければ undefined）。
 * @param entry 記録
 * @param note 入力欄のメモ
 * @param state 写真の状態
 * @returns 保存の入力。変更が無ければ undefined
 */
function saveInputOf(entry: VisitLogEntryDto, note: string, state: EditorState): SaveVisitMemoryInput | undefined {
  const log = logger.fn('saveInputOf', { photoChanged: state.photoChanged, noteLength: note.length });
  const noteChanged = note !== (entry.note ?? '');
  if (!noteChanged && !state.photoChanged) return log.exit(undefined, '変更なし');
  return log.exit({ spotId: entry.spotId, localDate: entry.localDate, ...(noteChanged ? { note } : {}), ...(state.photoChanged ? { photo: state.photo ?? null } : {}) }, 'changed');
}

/**
 * 思い出の編集を開く。
 * @param opts 記録・上限・保存／スポット詳細／失敗の処理
 * @returns モーダルの操作
 * @sideEffect 画面にモーダルを出す
 */
export function openMemoryEditor(opts: MemoryEditorOptions): ModalHandle {
  const { entry } = opts;
  const log = logger.fn('openMemoryEditor', { spotId: entry.spotId, localDate: entry.localDate });
  const photo = createPhotoPart(opts);
  const note = h('textarea', { class: 'memory-editor__note', attrs: { rows: 3, maxlength: opts.noteMax, placeholder: 'メモ', 'aria-label': 'メモ', 'data-testid': 'memory-note' } });
  note.value = entry.note ?? '';
  const openSpot = createButton({
    label: '詳細へ',
    ariaLabel: 'スポット詳細へ',
    variant: 'secondary',
    testId: 'memory-open-spot',
    onClick: (): void => {
      modal.close();
      opts.onOpenSpot(entry.spotId);
    },
  });
  const body = h('div', { class: 'memory-editor', attrs: { 'data-testid': 'memory-editor' } }, [
    photo.frame,
    photo.credit,
    h('p', { class: 'memory-editor__meta' }, [
      h('span', { class: 'memory-editor__date', text: `${entry.dateLabel} ${entry.time}` }),
      h('span', { text: entry.districtName }),
      h('span', { text: nthLabel(entry.nth) }),
    ]),
    h('div', { class: 'memory-editor__tools' }, [...photo.tools, openSpot]),
    note,
  ]);
  /**
   * 変えた項目があれば保存を頼む。
   * @sideEffect onSave を呼ぶ
   */
  const save = (): void => {
    const saveLog = logger.fn('save');
    const input = saveInputOf(entry, note.value, photo.state);
    if (input !== undefined) opts.onSave(input);
    saveLog.exit(undefined);
  };
  const modal: ModalHandle = openModal({
    title: entry.spotName,
    body,
    testId: 'memory-modal',
    actions: [
      { label: 'とじる', variant: 'secondary', testId: 'memory-close', onClick: (): void => undefined },
      { label: '保存', variant: 'primary', testId: 'memory-save', onClick: save },
    ],
  });
  return log.exit(modal);
}
