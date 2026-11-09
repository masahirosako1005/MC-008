/**
 * @file 設定画面（presentation/screens/Settings 層。ルート '#/settings'、wireframes/10_settings）
 * 主役は文字の大きさ（標準／大／特大）。選んだ瞬間に html[data-text-scale] を書き換えて全画面へ反映し、端末に保存する（CLAUDE.md 6.1、基準 A）。
 * 保存に失敗したら元の大きさに戻してトーストで知らせる。通知・位置情報は将来項目として操作できない見た目で置く（wireframes/10_settings 注記3）。
 * 「データ」のまとまりで、保存データの書き出し（DI-21）とすべての削除（PRV-05）ができる（DataPanel.ts）。
 * 右上の歯車の通常タップで開く（GearMenu）。上部バーの「戻る」は直前の画面へ（履歴が無ければ地図）。
 */
import '@/presentation/screens/Settings/SettingsScreen.css';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { applyTextScale, currentTextScale, isTextScale } from '@/Common/ui/a11y/textScale';
import type { TextScale } from '@/Common/ui/a11y/textScale';
import { createSpotCard } from '@/Common/ui/cards/SpotCard';
import { h } from '@/Common/ui/dom';
import { createTopBar } from '@/Common/ui/TopBar';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { createDataPanelItems } from '@/presentation/screens/Settings/DataPanel';
import {
  FUTURE_NOTIFICATIONS,
  PREVIEW_SPOT,
  TEXT_SCALE_OPTIONS,
  aboutRows,
  dataNote,
  locationNote,
  locationUsageText,
  nextScaleForKey,
  saveFailedMessage,
  textScaleNote,
} from '@/presentation/screens/Settings/settingsModel';
import type { SettingsRow } from '@/presentation/screens/Settings/settingsModel';

const logger = createLogger('presentation/screens/Settings/SettingsScreen');

/**
 * 設定画面を作る。
 * @param ctx 画面コンテキスト
 * @param params ルートのパラメータ（なし）
 * @returns 画面
 */
export function createSettingsScreen(ctx: AppContext, params: Readonly<Record<string, string>>): Screen {
  const log = logger.fn('createSettingsScreen', { keys: Object.keys(params) });
  const controller = new SettingsController(ctx);
  const screen: Screen = {
    mount: (root: HTMLElement): Promise<void> => controller.mount(root),
    unmount: (): void => controller.unmount(),
  };
  return log.exit(screen);
}

/** createGroup のオプション */
interface GroupOptions {
  /** カードの下に添える補足 */
  readonly note?: string;
  /** 行ではなく部品を並べるカード（四辺に余白を取る） */
  readonly padded?: boolean;
}

/**
 * 見出し付きのまとまり（白いカード）を作る。
 * @param id 見出しの id（aria-labelledby 用）
 * @param title 見出し
 * @param children カードの中身
 * @param opts 補足・余白
 * @returns section 要素
 */
function createGroup(id: string, title: string, children: readonly HTMLElement[], opts: GroupOptions = {}): HTMLElement {
  const log = logger.fn('createGroup', { id });
  return log.exit(
    h('section', { class: 'settings-group', attrs: { 'aria-labelledby': id, 'data-testid': `settings-group-${id}` } }, [
      h('h2', { class: 'settings-group__title', attrs: { id }, text: title }),
      h('div', { class: ['settings-card', opts.padded === true && 'settings-card--padded'] }, children),
      opts.note === undefined ? undefined : h('p', { class: ['hint', 'settings-group__note'], text: opts.note }),
    ]),
  );
}

/**
 * 見出しと値の1行を作る。
 * @param row 見出しと値
 * @returns div 要素
 */
function createRow(row: SettingsRow): HTMLElement {
  const log = logger.fn('createRow', { label: row.label });
  return log.exit(h('div', { class: 'settings-row' }, [h('span', { class: 'settings-row__label', text: row.label }), h('span', { class: 'settings-row__value', text: row.value })]));
}

/**
 * 操作できない（将来の）切替スイッチの1行を作る。押しても何も起きないことを見た目と読み上げで示す。
 * @param label 項目名
 * @param index 並び順（id 用）
 * @returns div 要素
 */
function createFutureSwitchRow(label: string, index: number): HTMLElement {
  const log = logger.fn('createFutureSwitchRow', { index });
  const labelId = `settings-notify-${index}`;
  const toggle = h('span', {
    class: 'settings-switch',
    attrs: { role: 'switch', 'aria-checked': 'false', 'aria-disabled': 'true', 'aria-labelledby': labelId, 'data-testid': `settings-notify-${index}` },
  });
  return log.exit(h('div', { class: ['settings-row', 'settings-row--future'] }, [h('span', { class: 'settings-row__label', attrs: { id: labelId }, text: label }), toggle]));
}

/**
 * 文字の大きさのプレビュー（地図下シートと同じスポットカード）を作る。html のルートフォントで大きさが変わる。
 * @returns div 要素
 */
function createPreview(): HTMLElement {
  const log = logger.fn('createPreview');
  const card = createSpotCard({
    status: 'visited',
    name: PREVIEW_SPOT.name,
    kindLabel: PREVIEW_SPOT.kindLabel,
    meters: PREVIEW_SPOT.meters,
    subtitle: PREVIEW_SPOT.subtitle,
    chips: [PREVIEW_SPOT.chip],
    districtId: PREVIEW_SPOT.districtId,
  });
  return log.exit(
    h('div', { class: 'settings-preview', attrs: { 'data-testid': 'settings-preview', 'aria-label': 'プレビュー' } }, [
      h('span', { class: 'settings-preview__label', attrs: { 'aria-hidden': 'true' }, text: 'プレビュー' }),
      card,
    ]),
  );
}

/** 設定画面の状態と操作を受け持つ */
class SettingsController {
  private readonly ctx: AppContext;
  /** 文字の大きさのボタン（値ごと） */
  private readonly scaleButtons = new Map<TextScale, HTMLButtonElement>();
  /** 保存が済んでいる文字の大きさ（保存に失敗したらここへ戻す） */
  private saved: TextScale = currentTextScale();
  /** 画面で選んでいる文字の大きさ */
  private selected: TextScale = currentTextScale();
  /** 保存の世代（連打したとき、古い保存の失敗で新しい選択を戻さない） */
  private saveToken = 0;
  /** 画面を離れた（以降の非同期結果は捨てる） */
  private disposed = false;

  /**
   * コントローラを作る。
   * @param ctx 画面コンテキスト
   */
  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  /**
   * 保存済みの設定を読み、画面を組み立てる。読めなければ今の表示（html の属性）のまま出す。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加する
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount');
    const loaded = await this.ctx.services.settings.execute();
    if (this.disposed) return log.exit(undefined, '表示前に画面を離れた');
    if (loaded.ok && isTextScale(loaded.value.textScale)) {
      this.saved = loaded.value.textScale;
      this.selected = loaded.value.textScale;
    } else if (!loaded.ok) {
      log.warn('設定を読み込めないため、今の表示のまま出します', { code: loaded.error.code });
    }
    const topBar = createTopBar({ title: '設定', back: { label: '戻る', testId: 'settings-back', onClick: (): void => this.ctx.router.back() } });
    const body = h('div', { class: 'screen-scroll' }, [
      h('div', { class: 'settings', attrs: { 'data-testid': 'settings' } }, [
        this.buildTextScaleGroup(),
        this.buildNotificationGroup(),
        this.buildLocationGroup(),
        createGroup('settings-data', 'データ', createDataPanelItems(this.ctx), { note: dataNote(this.ctx.services.isDemo), padded: true }),
        this.buildAboutGroup(),
      ]),
    ]);
    root.append(topBar, body);
    this.render();
    log.exit(undefined);
  }

  /**
   * 後始末する（保存中の結果は捨てる）。
   */
  unmount(): void {
    const log = logger.fn('unmount');
    this.disposed = true;
    this.scaleButtons.clear();
    log.exit(undefined);
  }

  /**
   * 「文字の大きさ」のまとまり（3択・プレビュー・補足）を作る。
   * @returns section 要素
   */
  private buildTextScaleGroup(): HTMLElement {
    const log = logger.fn('buildTextScaleGroup');
    const buttons = TEXT_SCALE_OPTIONS.map((option) => {
      const button = h(
        'button',
        {
          class: ['text-scale-option', `text-scale-option--${option.value}`],
          attrs: { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': `${option.label}（${option.description}）`, 'data-testid': `text-scale-${option.value}`, 'data-scale': option.value },
          on: {
            click: (): void => {
              setCorrelationId();
              void this.select(option.value);
            },
            keydown: (event): void => this.onKeyDown(event, option.value),
          },
        },
        [h('span', { class: 'text-scale-option__glyph', attrs: { 'aria-hidden': 'true' }, text: 'あ' }), h('span', { class: 'text-scale-option__label', text: option.label })],
      );
      this.scaleButtons.set(option.value, button);
      return button;
    });
    const picker = h('div', { class: 'text-scale-picker', attrs: { role: 'radiogroup', 'aria-labelledby': 'settings-text', 'data-testid': 'text-scale-picker' } }, buttons);
    return log.exit(createGroup('settings-text', '文字の大きさ', [picker, createPreview()], { note: textScaleNote(this.ctx.services.isDemo), padded: true }));
  }

  /**
   * 「通知」のまとまり（将来項目。操作できない）を作る。
   * @returns section 要素
   */
  private buildNotificationGroup(): HTMLElement {
    const log = logger.fn('buildNotificationGroup');
    const rows = FUTURE_NOTIFICATIONS.map((label, i) => createFutureSwitchRow(label, i));
    return log.exit(createGroup('settings-notify', '通知', rows, { note: 'お知らせは今後のアップデートで選べるようになります。' }));
  }

  /**
   * 「位置情報」のまとまりを作る。
   * @returns section 要素
   */
  private buildLocationGroup(): HTMLElement {
    const log = logger.fn('buildLocationGroup');
    const isDemo = this.ctx.services.isDemo;
    const row = createRow({ label: '位置情報の利用', value: locationUsageText(isDemo) });
    return log.exit(createGroup('settings-location', '位置情報', [row], { note: locationNote(isDemo) }));
  }

  /**
   * 「このアプリについて」のまとまりを作る。
   * @returns section 要素
   */
  private buildAboutGroup(): HTMLElement {
    const log = logger.fn('buildAboutGroup');
    return log.exit(createGroup('settings-about', 'このアプリについて', aboutRows(this.ctx.services.isDemo).map(createRow)));
  }

  /**
   * 矢印キー・Home/End で選択を動かす（ラジオグループの操作）。
   * @param event キー入力
   * @param from 押されたボタンの値
   * @sideEffect 選択を変え、フォーカスを移す
   */
  private onKeyDown(event: KeyboardEvent, from: TextScale): void {
    const next = nextScaleForKey(from, event.key);
    if (next === undefined) return;
    event.preventDefault();
    setCorrelationId();
    const log = logger.fn('onKeyDown', { from, next });
    void this.select(next);
    this.scaleButtons.get(next)?.focus();
    log.exit(undefined);
  }

  /**
   * 文字の大きさを選ぶ。すぐに画面へ反映し、端末に保存する。保存に失敗したら保存済みの大きさに戻す。
   * @param scale 選んだ文字の大きさ
   * @sideEffect html[data-text-scale] を書き換え、設定を保存する。失敗時はトーストを出す
   */
  private async select(scale: TextScale): Promise<void> {
    const log = logger.fn('select', { scale, selected: this.selected });
    if (scale === this.selected) return log.exit(undefined, '同じ大きさ');
    this.selected = scale;
    applyTextScale(scale);
    this.render();
    const token = ++this.saveToken;
    const result = await this.ctx.services.updateTextScale.execute({ textScale: scale });
    if (result.ok) {
      this.saved = scale;
      return log.exit(undefined);
    }
    // 画面を離れていても、表示だけ大きいまま保存されていない状態は残さない
    if (token === this.saveToken) {
      this.selected = this.saved;
      applyTextScale(this.saved);
      if (!this.disposed) this.render();
      this.ctx.toast.show(saveFailedMessage(this.saved), { kind: 'error' });
    }
    log.fail(undefined, result.error.code);
  }

  /**
   * 選択状態（aria-checked と、矢印キーで入る1つだけの tabindex）を描き直す。
   * @sideEffect ボタンの属性を書き換える
   */
  private render(): void {
    const log = logger.fn('render', { selected: this.selected });
    for (const [value, button] of this.scaleButtons) {
      const on = value === this.selected;
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      button.tabIndex = on ? 0 : -1;
    }
    log.exit(undefined);
  }
}
