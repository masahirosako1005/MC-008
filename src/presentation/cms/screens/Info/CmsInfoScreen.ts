/**
 * @file 店舗CMS の「お店の情報」（presentation/cms/screens/Info。docs/09 C03、CMS-S01・S02・S04・S09・S12）
 * 左：お店のページの見え方（入力のたびに更新。入力中の欄に対応する部分を囲む）／右：営業時間・定休日・補足・便利情報。
 * 下端のバーで保存する。主ボタンは常に「保存」（失敗した後だけ「再試行」）。変更が無いときに押すと、確認したことを記録する（はじめにやることが進む）。
 * 変更が無いときは「元に戻す」を出さない。スマホ幅の「見え方」ボタンは見出しの行に置く（下端のバーは「状態｜元に戻す｜保存」だけ）。
 * 入力中の値はページを移っても残る（ctx.draft）。説明文は置かない。
 */
import type { CmsBusinessHoursDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { createButton, setButtonDisabled, setButtonLabel } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import type { Child } from '@/Common/ui/dom';
import type { Amenity } from '@/domain/spot/Amenity';
import { createBusinessHours, formatBusinessHours, HOURS_NOTE_MAX, WEEKDAY_LABELS } from '@/domain/spot/BusinessHours';
import { createPreviewColumn, liveEventsOf } from '@/presentation/cms/cmsPhonePreview';
import type { PreviewColumnHandle, PreviewTarget } from '@/presentation/cms/cmsPhonePreview';
import { actionBar, attachFieldError, formSection, icon, pageTitle, previewButton, textField, twoColumn } from '@/presentation/cms/cmsUi';
import type { CmsContext } from '@/presentation/cms/cmsUi';
import { newOperationId } from '@/presentation/shared/operation';
import { AMENITY_LABELS, AMENITY_ORDER } from '@/presentation/shared/labels';

const logger = createLogger('presentation/cms/screens/Info/CmsInfoScreen');

/** 時刻の選択肢の範囲（時）と刻み（分） */
const TIME_RANGE = { firstHour: 5, lastHour: 24, stepMinutes: 30 } as const;

/** 営業時間が読めないとき（'境内自由' など）の入力欄の初期値 */
const DEFAULT_HOURS: CmsBusinessHoursDto = { open: '10:00', close: '18:00', closedDays: [] };

/** 入力中の値 */
interface InfoDraft {
  open: string;
  close: string;
  note: string;
  readonly closedDays: Set<number>;
  readonly amenities: Set<string>;
  /** 保存に失敗した直後か */
  failed: boolean;
}

/** 入力のたびに更新する部品 */
interface InfoParts {
  readonly preview: PreviewColumnHandle;
  readonly status: HTMLElement;
  readonly timeError: (message: string) => void;
  readonly noteError: (message: string) => void;
  readonly saveButton: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
}

/**
 * 時刻の選択肢（5:00〜24:00、30分刻み）を返す。
 * @returns 'H:MM' の配列
 */
export function timeOptions(): readonly string[] {
  const log = logger.fn('timeOptions');
  const options: string[] = [];
  for (let m = TIME_RANGE.firstHour * 60; m <= TIME_RANGE.lastHour * 60; m += TIME_RANGE.stepMinutes) {
    options.push(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
  }
  return log.exit(options);
}

/**
 * 保存済みの値から入力中の値を作る。
 * @param ctx 文脈
 * @returns 入力中の値
 */
function draftFromInfo(ctx: CmsContext): InfoDraft {
  const log = logger.fn('draftFromInfo', { spotId: ctx.info.id });
  const hours = ctx.info.hours ?? DEFAULT_HOURS;
  return log.exit({ open: hours.open, close: hours.close, note: hours.note ?? '', closedDays: new Set(hours.closedDays), amenities: new Set(ctx.info.amenities), failed: false });
}

/**
 * 入力中の営業時間を表示用の文字列にする。
 * @param draft 入力中の値
 * @returns 成功なら表示用の文字列、誤りなら誤りの文と欄
 */
function hoursTextOf(draft: InfoDraft): { readonly ok: boolean; readonly text: string; readonly field?: string } {
  const log = logger.fn('hoursTextOf', { open: draft.open, close: draft.close });
  const hours = createBusinessHours({ open: draft.open, close: draft.close, closedDays: [...draft.closedDays], note: draft.note });
  if (hours.ok) return log.exit({ ok: true, text: formatBusinessHours(hours.value) });
  const field = String(hours.error.details?.['field'] ?? '');
  return log.exit({ ok: false, text: field === 'close' ? '閉店は開店より後にしてください' : hours.error.message, field });
}

/**
 * 保存済みの値から変わったかを返す。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @returns 変わっていれば true
 */
function isChanged(ctx: CmsContext, draft: InfoDraft): boolean {
  const log = logger.fn('isChanged');
  const hours = hoursTextOf(draft);
  const amenities = AMENITY_ORDER.filter((a) => draft.amenities.has(a)).join(',');
  const saved = AMENITY_ORDER.filter((a) => ctx.info.amenities.includes(a)).join(',');
  return log.exit(!hours.ok || hours.text !== ctx.info.hoursText || amenities !== saved);
}

/**
 * 時刻を選ぶ欄を作る（選択肢に無い値も先頭に足す）。
 * @param label 読み上げ名
 * @param value 初期値
 * @param testId テスト用 ID
 * @param onChange 選んだときの処理
 * @returns select
 */
function timeSelect(label: string, value: string, testId: string, onChange: (value: string) => void): HTMLSelectElement {
  const log = logger.fn('timeSelect', { label, value });
  const options = timeOptions();
  const values = options.includes(value) ? options : [value, ...options];
  const select = h('select', { class: 'cms-select cms-select--time', attrs: { 'data-testid': testId, id: testId, 'aria-label': label } }, values.map((v) => h('option', { attrs: { value: v, selected: v === value }, text: v })));
  select.addEventListener('change', () => onChange(select.value));
  return log.exit(select);
}

/**
 * 営業時間・定休日・補足の区切りを作る。
 * @param draft 入力中の値
 * @param onChange 変わったときの処理
 * @param onFocus 欄に入ったときの処理
 * @returns 区切りと、誤りを出す関数
 */
function hoursSection(draft: InfoDraft, onChange: () => void, onFocus: (target: PreviewTarget) => void): { readonly element: HTMLElement; readonly timeError: (m: string) => void; readonly noteError: (m: string) => void } {
  const log = logger.fn('hoursSection', { open: draft.open, close: draft.close });
  const open = timeSelect('開店', draft.open, 'cms-open', (v) => { draft.open = v; onChange(); });
  const close = timeSelect('閉店', draft.close, 'cms-close', (v) => { draft.close = v; onChange(); });
  const error = attachFieldError(close, 'cms-hours-error');
  const days = WEEKDAY_LABELS.map((label, day) => {
    const button = h('button', { class: 'cms-day', attrs: { type: 'button', 'aria-pressed': draft.closedDays.has(day) ? 'true' : 'false', 'data-testid': `cms-closed-${day}` }, text: label });
    button.addEventListener('click', () => {
      if (draft.closedDays.has(day)) draft.closedDays.delete(day);
      else draft.closedDays.add(day);
      button.setAttribute('aria-pressed', draft.closedDays.has(day) ? 'true' : 'false');
      onChange();
    });
    return button;
  });
  const note = textField({ label: '補足', max: HOURS_NOTE_MAX, value: draft.note, placeholder: '例：土曜は15時まで', testId: 'cms-hours-note', onInput: (v) => { draft.note = v; onChange(); }, onFocus: () => onFocus('hours') });
  const element = formSection(undefined, [
    h('div', { class: 'cms-field' }, [h('span', { class: 'cms-field__label', attrs: { id: 'cms-hours-label' }, text: '営業時間' }), h('div', { class: 'cms-inline', attrs: { role: 'group', 'aria-labelledby': 'cms-hours-label' } }, [open, h('span', { class: 'cms-muted', text: '〜' }), close]), error.element]),
    h('div', { class: 'cms-field' }, [h('span', { class: 'cms-field__label', attrs: { id: 'cms-closed-label' }, text: '定休日' }), h('div', { class: 'cms-days', attrs: { role: 'group', 'aria-labelledby': 'cms-closed-label' } }, days)]),
    note.element,
  ], { testId: 'cms-hours' });
  element.addEventListener('focusin', () => onFocus('hours'));
  return log.exit({ element, timeError: error.setError, noteError: note.setError });
}

/**
 * 便利情報の区切り（2列のチェック）を作る。
 * @param draft 入力中の値
 * @param onChange 変わったときの処理
 * @param onFocus 欄に入ったときの処理
 * @returns 区切り
 */
function amenitySection(draft: InfoDraft, onChange: () => void, onFocus: (target: PreviewTarget) => void): HTMLElement {
  const log = logger.fn('amenitySection', { count: draft.amenities.size });
  const tiles = AMENITY_ORDER.map((amenity: Amenity) => {
    const tile = h('button', { class: 'cms-check', attrs: { type: 'button', role: 'checkbox', 'aria-checked': draft.amenities.has(amenity) ? 'true' : 'false', 'data-testid': `cms-amenity-${amenity}` } }, [
      h('span', { class: 'cms-check__box', attrs: { 'aria-hidden': 'true' } }, [icon('check')]), AMENITY_LABELS[amenity],
    ]);
    tile.addEventListener('click', () => {
      if (draft.amenities.has(amenity)) draft.amenities.delete(amenity);
      else draft.amenities.add(amenity);
      tile.setAttribute('aria-checked', draft.amenities.has(amenity) ? 'true' : 'false');
      onChange();
    });
    return tile;
  });
  const element = formSection('便利情報', [h('div', { class: 'cms-checks', attrs: { role: 'group', 'aria-label': '便利情報' } }, tiles)], { testId: 'cms-amenities' });
  element.addEventListener('focusin', () => onFocus('amenities'));
  return log.exit(element);
}

/**
 * 下端のバーの状態とボタンを合わせる（閉店時刻の誤りなどで保存できないときも「未保存の変更」と出す）。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param parts 部品
 * @sideEffect バーを書き換える
 */
function paintBar(ctx: CmsContext, draft: InfoDraft, parts: InfoParts): void {
  const log = logger.fn('paintBar');
  const hours = hoursTextOf(draft);
  const changed = isChanged(ctx, draft);
  const confirmed = ctx.info.edited;
  const state = draft.failed ? 'failed' : !hours.ok ? 'error' : changed ? 'dirty' : confirmed ? 'saved' : 'todo';
  const status: Record<typeof state, Child[]> = {
    failed: ['保存できませんでした'], error: unsavedMark(), dirty: unsavedMark(), saved: [icon('check'), '保存済み'], todo: [],
  };
  parts.status.replaceChildren(...status[state].filter((c): c is Node | string => typeof c === 'string' || c instanceof Node));
  parts.status.dataset.state = state;
  setButtonLabel(parts.saveButton, state === 'failed' ? '再試行' : '保存');
  setButtonDisabled(parts.saveButton, state === 'error' || state === 'saved');
  parts.resetButton.hidden = !(state === 'dirty' || state === 'error' || state === 'failed');
  log.exit(undefined);
}

/**
 * 「未保存の変更」の印（点と文字）を作る。
 * @returns 子要素の並び
 */
function unsavedMark(): Child[] {
  return [h('span', { class: 'cms-dot', attrs: { 'aria-hidden': 'true' } }), '未保存の変更'];
}

/**
 * 入力のたびに、見え方・誤り・バーを更新する。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param parts 部品
 * @sideEffect DOM を書き換え、未保存の有無を CmsApp に知らせる
 */
function refresh(ctx: CmsContext, draft: InfoDraft, parts: InfoParts): void {
  const log = logger.fn('refresh');
  const hours = hoursTextOf(draft);
  parts.preview.update({ hours: hours.ok ? hours.text : ctx.info.hoursText, amenities: AMENITY_ORDER.filter((a) => draft.amenities.has(a)), events: liveEventsOf(ctx.info.events) });
  parts.timeError(!hours.ok && hours.field !== 'note' ? hours.text : '');
  parts.noteError(!hours.ok && hours.field === 'note' ? hours.text : '');
  paintBar(ctx, draft, parts);
  ctx.setDirty('info', isChanged(ctx, draft));
  log.exit(undefined);
}

/**
 * 保存する（変更が無いときは確認の記録として同じ内容を保存する）。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param parts 部品
 * @sideEffect 店舗CMS の登録内容を保存し、利用者アプリに反映させる
 */
async function save(ctx: CmsContext, draft: InfoDraft, parts: InfoParts): Promise<void> {
  const log = logger.fn('save', { spotId: ctx.info.id });
  setButtonLabel(parts.saveButton, '保存中…');
  const result = await ctx.services.saveShopInfo.execute({
    spotId: ctx.info.id,
    hours: { open: draft.open, close: draft.close, closedDays: [...draft.closedDays], note: draft.note },
    amenities: [...draft.amenities],
    operationId: newOperationId(),
  });
  if (!result.ok) {
    draft.failed = true;
    paintBar(ctx, draft, parts);
    return log.fail(undefined, result.error.code);
  }
  ctx.discardDraft('info');
  ctx.toast.show('保存しました');
  ctx.update(result.value);
  return log.exit(undefined);
}

/**
 * 「お店の情報」画面を作る。
 * @param ctx 文脈
 * @returns 画面の要素
 */
export function renderCmsInfoScreen(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderCmsInfoScreen', { spotId: ctx.info.id });
  const draft = ctx.draft('info', () => draftFromInfo(ctx));
  const preview = createPreviewColumn(ctx.info);
  let parts: InfoParts | undefined;
  /** 入力が変わるたびに部品を更新する */
  const onChange = (): void => { draft.failed = false; if (parts) refresh(ctx, draft, parts); }; // audit-ignore: fnlog-missing 入力のたびに呼ぶ中継（ログは refresh が出す）
  /** 入力中の欄に対応する部分を囲む */
  const onFocus = (target: PreviewTarget): void => preview.highlight(target); // audit-ignore: fnlog-missing フォーカスのたびに呼ぶ中継
  const hours = hoursSection(draft, onChange, onFocus);
  const status = h('span', { class: 'cms-status', attrs: { 'aria-live': 'polite', 'data-testid': 'cms-save-status' } });
  const resetButton = createButton({ label: '元に戻す', variant: 'ghost', testId: 'cms-info-reset', onClick: () => { ctx.discardDraft('info'); ctx.update(ctx.info); } });
  const saveButton = createButton({ label: '保存', variant: 'primary', testId: 'cms-info-save', onClick: () => (parts ? save(ctx, draft, parts) : undefined) });
  parts = { preview, status, timeError: hours.timeError, noteError: hours.noteError, saveButton, resetButton };
  refresh(ctx, draft, parts);
  const form = h('div', { class: 'cms-panel', attrs: { 'data-testid': 'cms-screen-info' } }, [
    pageTitle('お店の情報', previewButton(ctx)),
    hours.element,
    amenitySection(draft, onChange, onFocus),
    h('p', { class: 'cms-footnote', text: '店名・紹介文の変更は運営者へ連絡してください' }),
    actionBar(status, [resetButton, saveButton]),
  ]);
  return log.exit(twoColumn(preview.element, form));
}
