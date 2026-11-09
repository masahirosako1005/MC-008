/**
 * @file 店舗CMS の「お店の情報」画面（presentation/cms/screens/Info。docs/09 C03、CMS-S01・S02・S04・S12）
 * 営業時間（全曜日共通の時間＋定休日）と便利情報6種を直し、保存するとアプリにすぐ反映される（すぐ公開＝CMS-S09）。
 * 初めての人がつまずかないように：
 * - 右側（スマホでは下）に「アプリでの見え方」をその場で出し、変えたところは「いま → 変更後」で見せる
 * - 閉店が開店より前などの誤りは、その欄のすぐ下に出し、直すまで保存できない
 * - 画面の下に保存バーを固定し、「保存していない変更」の有無と「元に戻す」をいつでも見せる
 * - 入力中の値はページを移っても残る（ctx.draft）
 */
import type { CmsBusinessHoursDto } from '@/application/dto/CmsDto';
import { createLogger } from '@/Common/logging/logger';
import { formatJpTime, localDateOf, parseInstant } from '@/Common/utils/date';
import { createButton, setButtonDisabled } from '@/Common/ui/Button';
import { createChip } from '@/Common/ui/Chip';
import { h } from '@/Common/ui/dom';
import { createBusinessHours, formatBusinessHours, WEEKDAY_LABELS } from '@/domain/spot/BusinessHours';
import type { Amenity } from '@/domain/spot/Amenity';
import { attachFieldError, closedDaysText, cmsErrorLine, cmsSection, pageHeader, shortDate } from '@/presentation/cms/cmsUi';
import type { CmsContext } from '@/presentation/cms/cmsUi';
import { newOperationId } from '@/presentation/shared/operation';
import { AMENITY_LABELS, AMENITY_ORDER } from '@/presentation/shared/labels';

const logger = createLogger('presentation/cms/screens/Info/CmsInfoScreen');

/** 時刻の選択肢の範囲（時）と刻み（分） */
const TIME_RANGE = { firstHour: 5, lastHour: 24, stepMinutes: 30 } as const;

/** 営業時間が読めないとき（'境内自由' など）の入力欄の初期値 */
const DEFAULT_HOURS: CmsBusinessHoursDto = { open: '10:00', close: '18:00', closedDays: [] };

/** 便利情報の意味（初めての人が迷わないための一言） */
export const AMENITY_HINTS: Readonly<Record<Amenity, string>> = {
  kids: '子ども連れでも入りやすい（いす・メニューなど）',
  toilet: 'お客さんが使えるトイレがある',
  nursing: '授乳やおむつ替えができる場所がある',
  stroller: 'ベビーカーのまま入れる',
  rainOk: '屋内で過ごせて、雨の日でも困らない',
  parking: '車を止められる（提携の駐車場を含む）',
};

/** 入力中の値 */
interface InfoDraft {
  open: string;
  close: string;
  readonly closedDays: Set<number>;
  readonly amenities: Set<string>;
}

/** 画面の部品（入力のたびに更新するもの） */
interface InfoParts {
  readonly previewHost: HTMLElement;
  readonly status: HTMLElement;
  readonly closedSummary: HTMLElement;
  readonly timeError: (message: string) => void;
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
  return log.exit({ open: hours.open, close: hours.close, closedDays: new Set(hours.closedDays), amenities: new Set(ctx.info.amenities) });
}

/**
 * 入力中の営業時間を表示用の文字列にする。
 * @param draft 入力中の値
 * @returns 成功なら表示用の文字列、誤りなら説明
 */
function hoursTextOf(draft: InfoDraft): { readonly ok: boolean; readonly text: string } {
  const log = logger.fn('hoursTextOf', { open: draft.open, close: draft.close });
  const hours = createBusinessHours({ open: draft.open, close: draft.close, closedDays: [...draft.closedDays] });
  return log.exit(hours.ok ? { ok: true, text: formatBusinessHours(hours.value) } : { ok: false, text: hours.error.message });
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
 * 時刻を選ぶ欄を作る（選択肢に無い値も先頭に足して選べるようにする）。
 * @param label 名前
 * @param value 初期値
 * @param testId テスト用 ID
 * @param onChange 選んだときの処理
 * @returns ラベルと select
 */
function timeSelect(label: string, value: string, testId: string, onChange: (value: string) => void): { readonly element: HTMLElement; readonly select: HTMLSelectElement } {
  const log = logger.fn('timeSelect', { label, value });
  const options = timeOptions();
  const values = options.includes(value) ? options : [value, ...options];
  const select = h('select', { class: 'cms-input cms-input--time', attrs: { 'data-testid': testId, id: testId } },
    values.map((v) => h('option', { attrs: { value: v, selected: v === value }, text: v })));
  select.addEventListener('change', () => onChange(select.value));
  return log.exit({ element: h('div', { class: 'cms-field cms-field--inline' }, [h('label', { class: 'cms-field__label', attrs: { for: testId }, text: label }), select]), select });
}

/**
 * アプリのスポット詳細での見え方を作る（変えたところは「いま → 変更後」）。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @returns プレビューの要素
 */
function renderPreview(ctx: CmsContext, draft: InfoDraft): HTMLElement {
  const log = logger.fn('renderPreview', { spotId: ctx.info.id });
  const hours = hoursTextOf(draft);
  const hoursChanged = hours.ok && hours.text !== ctx.info.hoursText;
  const tags = AMENITY_ORDER.filter((a) => draft.amenities.has(a)).map((a) => h('span', { class: ['cms-preview__tag', !ctx.info.amenities.includes(a) && 'cms-preview__tag--new'] }, [`✓ ${AMENITY_LABELS[a]}`]));
  return log.exit(h('div', { class: 'cms-preview', attrs: { 'data-testid': 'cms-info-preview', 'aria-live': 'polite' } }, [
    h('p', { class: 'cms-preview__kicker', text: 'アプリのお店のページでの見え方' }),
    h('p', { class: 'cms-preview__name', text: ctx.info.name }),
    h('p', { class: 'cms-preview__meta', text: `${ctx.info.category}・${ctx.info.districtName}` }),
    h('div', { class: 'cms-preview__tags' }, tags.length > 0 ? tags : [h('span', { class: 'cms-note', text: '便利情報なし' })]),
    h('dl', { class: 'cms-preview__rows' }, [
      h('dt', { text: '営業時間' }),
      h('dd', { attrs: { 'data-testid': 'cms-preview-hours' } }, hours.ok
        ? [hoursChanged ? h('s', { class: 'cms-preview__old', text: ctx.info.hoursText }) : undefined, hoursChanged ? ' → ' : undefined, h('strong', { text: hours.text })]
        : [h('span', { class: 'cms-error', text: hours.text })]),
    ]),
  ]));
}

/**
 * 営業時間の区画を作る。
 * @param draft 入力中の値
 * @param closedSummary 定休日のまとめを出す要素
 * @param onChange 変わったときの処理
 * @returns 区画と、誤りを出す関数
 */
function renderHoursSection(draft: InfoDraft, closedSummary: HTMLElement, onChange: () => void): { readonly element: HTMLElement; readonly timeError: (message: string) => void } {
  const log = logger.fn('renderHoursSection', { open: draft.open, close: draft.close });
  const open = timeSelect('開店', draft.open, 'cms-open', (v) => { draft.open = v; onChange(); });
  const close = timeSelect('閉店', draft.close, 'cms-close', (v) => { draft.close = v; onChange(); });
  const error = attachFieldError(close.select, 'cms-hours-error');
  const dayChips = WEEKDAY_LABELS.map((label, day) => createChip({
    label, selected: draft.closedDays.has(day), testId: `cms-closed-${day}`,
    onToggle: (selected) => {
      if (selected) draft.closedDays.add(day);
      else draft.closedDays.delete(day);
      onChange();
    },
  }));
  const element = cmsSection('営業時間', [
    h('div', { class: 'cms-row' }, [open.element, h('span', { class: 'cms-row__sep', attrs: { 'aria-hidden': 'true' }, text: '〜' }), close.element]),
    error.element,
    h('p', { class: 'cms-field__label', attrs: { id: 'cms-closed-label' }, text: '定休日（休みの曜日をすべて選ぶ）' }),
    h('div', { class: 'cms-chips', attrs: { role: 'group', 'aria-labelledby': 'cms-closed-label' } }, dayChips),
    closedSummary,
  ], { step: 1, lead: '全曜日共通の時間と定休日を選びます。曜日ごとに違う時間は、のちほど対応します。', testId: 'cms-hours' });
  return log.exit({ element, timeError: error.setError });
}

/**
 * 便利情報の区画を作る（それぞれの意味を添える）。
 * @param draft 入力中の値
 * @param onChange 変わったときの処理
 * @returns 区画
 */
function renderAmenitySection(draft: InfoDraft, onChange: () => void): HTMLElement {
  const log = logger.fn('renderAmenitySection', { count: draft.amenities.size });
  const rows = AMENITY_ORDER.map((amenity) => h('li', { class: 'cms-amenity' }, [
    createChip({
      label: AMENITY_LABELS[amenity], selected: draft.amenities.has(amenity), testId: `cms-amenity-${amenity}`,
      onToggle: (selected) => {
        if (selected) draft.amenities.add(amenity);
        else draft.amenities.delete(amenity);
        onChange();
      },
    }),
    h('span', { class: 'cms-amenity__hint', text: AMENITY_HINTS[amenity] }),
  ]));
  return log.exit(cmsSection('便利情報', [h('ul', { class: 'cms-amenities' }, rows)], {
    step: 2, lead: 'あてはまるものをすべて選びます。子連れの方や雨の日のお客さんが、アプリでお店を探すときの決め手になります。', testId: 'cms-amenities',
  }));
}

/**
 * 変えられない項目（名前・カテゴリ・紹介文）の区画を作る。
 * @param ctx 文脈
 * @returns 区画
 */
function renderReadonlySection(ctx: CmsContext): HTMLElement {
  const log = logger.fn('renderReadonlySection');
  return log.exit(cmsSection('名前・カテゴリ・紹介文', [
    h('dl', { class: 'cms-readonly' }, [
      h('dt', { text: '名前' }), h('dd', { text: ctx.info.name }),
      h('dt', { text: 'カテゴリ' }), h('dd', { text: ctx.info.category }),
      h('dt', { text: '紹介文' }), h('dd', { text: ctx.info.description }),
    ]),
  ], { lead: 'これらは運営者が確認してから公開するため、いまは変えられません。直したいときは運営者に連絡してください。' }));
}

/**
 * 保存バー（保存していない変更の有無・元に戻す・保存）を作る。
 * @param onReset 元に戻すときの処理
 * @param onSave 保存するときの処理
 * @returns バーと部品
 */
function renderSaveBar(onReset: () => void, onSave: () => Promise<void>): { readonly element: HTMLElement; readonly status: HTMLElement; readonly saveButton: HTMLButtonElement; readonly resetButton: HTMLButtonElement } {
  const log = logger.fn('renderSaveBar');
  const status = h('p', { class: 'cms-savebar__status', attrs: { 'aria-live': 'polite', 'data-testid': 'cms-save-status' } });
  const resetButton = createButton({ label: '元に戻す', variant: 'ghost', testId: 'cms-info-reset', onClick: onReset });
  const saveButton = createButton({ label: '保存してアプリに反映', variant: 'primary', testId: 'cms-info-save', onClick: onSave });
  return log.exit({ element: h('div', { class: 'cms-savebar', attrs: { 'data-testid': 'cms-savebar' } }, [status, h('div', { class: 'cms-savebar__actions' }, [resetButton, saveButton])]), status, saveButton, resetButton });
}

/**
 * 最終更新の文字を作る。
 * @param updatedAt 最終更新（ISO。無ければ undefined）
 * @returns 例「11月9日（月）14:44 に保存」（無ければ「アプリ同梱の情報のまま」）
 */
function updatedText(updatedAt: string | undefined): string {
  const log = logger.fn('updatedText');
  const instant = parseInstant(updatedAt);
  return log.exit(instant.ok ? `${shortDate(localDateOf(instant.value))} ${formatJpTime(instant.value)} に保存` : 'まだ変更していません');
}

/**
 * 入力のたびに、プレビュー・誤り・保存バーを更新する。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param parts 部品
 * @sideEffect DOM を書き換え、保存していない変更の有無を CmsApp に知らせる
 */
function refreshParts(ctx: CmsContext, draft: InfoDraft, parts: InfoParts): void {
  const log = logger.fn('refreshParts');
  const hours = hoursTextOf(draft);
  const changed = isChanged(ctx, draft);
  parts.previewHost.replaceChildren(renderPreview(ctx, draft));
  parts.closedSummary.textContent = `いまの選択：${closedDaysText(draft.closedDays)}`;
  parts.timeError(hours.ok ? '' : hours.text);
  parts.status.textContent = !hours.ok ? '営業時間を直すと保存できます' : changed ? '保存していない変更があります' : `アプリに表示中（${updatedText(ctx.info.updatedAt)}）`;
  parts.status.dataset.state = !hours.ok ? 'error' : changed ? 'dirty' : 'clean';
  setButtonDisabled(parts.saveButton, !hours.ok || !changed);
  setButtonDisabled(parts.resetButton, !changed);
  ctx.setDirty('info', changed);
  log.exit(undefined);
}

/**
 * 保存する。
 * @param ctx 文脈
 * @param draft 入力中の値
 * @param showError 失敗の説明を出す関数
 * @sideEffect 店舗CMS の登録内容を保存し、利用者アプリに反映させる
 */
async function save(ctx: CmsContext, draft: InfoDraft, showError: (message: string) => void): Promise<void> {
  const log = logger.fn('save', { spotId: ctx.info.id });
  const result = await ctx.services.saveShopInfo.execute({
    spotId: ctx.info.id,
    hours: { open: draft.open, close: draft.close, closedDays: [...draft.closedDays] },
    amenities: [...draft.amenities],
    operationId: newOperationId(),
  });
  if (!result.ok) {
    showError(`保存できませんでした：${result.error.message}`);
    return log.fail(undefined, result.error.code);
  }
  showError('');
  ctx.discardDraft('info');
  ctx.toast.show('保存しました。アプリにすぐ表示されます', { kind: 'success' });
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
  const error = cmsErrorLine();
  const closedSummary = h('p', { class: 'cms-note', attrs: { 'data-testid': 'cms-closed-summary' } });
  let parts: InfoParts | undefined;
  /** 入力が変わるたびに部品を更新する */
  const onChange = (): void => { if (parts) refreshParts(ctx, draft, parts); }; // audit-ignore: fnlog-missing 入力のたびに呼ぶ中継（ログは refreshParts が出す）
  const hoursSection = renderHoursSection(draft, closedSummary, onChange);
  const bar = renderSaveBar(() => {
    ctx.discardDraft('info');
    ctx.update(ctx.info);
  }, () => save(ctx, draft, error.show));
  parts = { previewHost: h('div'), status: bar.status, closedSummary, timeError: hoursSection.timeError, saveButton: bar.saveButton, resetButton: bar.resetButton };
  refreshParts(ctx, draft, parts);
  const note = ctx.info.hours === undefined ? h('p', { class: 'cms-callout', text: `いまの表示「${ctx.info.hoursText}」は選ぶ形式に直せないため、仮の時間を入れています。正しい時間を選んで保存してください。` }) : undefined;
  const form = h('div', { class: 'cms-main-col' }, [note, hoursSection.element, renderAmenitySection(draft, onChange), error.element, renderReadonlySection(ctx)]);
  return log.exit(h('div', { class: 'cms-stack', attrs: { 'data-testid': 'cms-screen-info' } }, [
    pageHeader('お店の情報', '営業時間と、子連れ・雨の日などの便利情報を直します。保存すると、アプリのお店のページにすぐ表示されます。'),
    h('div', { class: 'cms-two-col' }, [form, h('aside', { class: 'cms-side', attrs: { 'aria-label': 'アプリでの見え方' } }, [parts.previewHost])]),
    bar.element,
  ]));
}
