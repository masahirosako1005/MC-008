/**
 * @file アバター画面（presentation/screens/Avatar 層。ルート '#/avatar'）
 * モバゲー風の着せ替え画面。上に動くステージ（背景・置くもの・相棒・称号つきのアバター）、下にカテゴリのタブと部品の格子。
 * - 持っている部品は押すとすぐ身につけ、少し待って自動で保存する（SaveAvatarUseCase）
 * - まだ持っていない部品は試着だけでき、手に入れ方・進み具合・「地図で向かう」を見せる（B 未開拓への興味・C 再訪動機）
 * - 部品は通った実績で手に入る。ここで手に入れることはできない（歩かずに稼げる仕組みは作らない＝CLAUDE.md 5 章）
 */
import { prefersReducedMotion } from '@/Common/ui/a11y/reducedMotion';
import '@/presentation/screens/Avatar/AvatarScreen.css';
import type { AvatarClosetDto, AvatarCoordDto, AvatarPartDto } from '@/application/dto/Dto';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { createCoordPanel, createColorChips, createPartDetail, createPartGrid, createTitleList } from '@/presentation/screens/Avatar/AvatarPanels';
import type { PartListInput } from '@/presentation/screens/Avatar/AvatarPanels';
import { CATEGORIES, clearSlot, equipPart, newCountOf, randomOutfitOf, sameOutfit, slotOfPartId, slotsOfCategory, unequipPart, withTryOn } from '@/presentation/screens/Avatar/avatarScreenModel';
import type { CategoryDef, CategoryKey } from '@/presentation/screens/Avatar/avatarScreenModel';
import { createAvatarIcon } from '@/presentation/screens/Avatar/avatarIcons';
import { createAvatarStage } from '@/presentation/screens/Avatar/AvatarStage';
import { composePhoto, savePhoto } from '@/presentation/screens/Avatar/photoFrame';
import type { AvatarStageHandle } from '@/presentation/screens/Avatar/AvatarStage';
import { createStageOverlay } from '@/presentation/screens/Avatar/StageOverlay';
import type { StageOverlayHandle } from '@/presentation/screens/Avatar/StageOverlay';
import { splitPartId, stageLookOf } from '@/presentation/shared/avatar/avatarLook';
import type { EmoteStyle } from '@/presentation/shared/avatar/avatarLook';
import type { AvatarPose } from '@/presentation/shared/avatar/avatarLook';

const logger = createLogger('presentation/screens/Avatar/AvatarScreen');

/** 自動保存までの待ち時間（ms。続けて選んだときは最後の1回だけ保存する） */
const SAVE_DELAY_MS = 450;

/**
 * アバター画面を作る。
 * @param ctx 画面コンテキスト
 * @returns 画面
 */
export function createAvatarScreen(ctx: AppContext): Screen {
  const log = logger.fn('createAvatarScreen');
  const controller = new AvatarController(ctx);
  return log.exit({
    mount: (root: HTMLElement): Promise<void> => controller.mount(root),
    unmount: (): void => controller.unmount(),
  });
}

/**
 * 0 以上 1 未満の乱数（おまかせ用。crypto を使う）。
 * @returns 乱数
 */
function cryptoRandom(): number { // audit-ignore: fnlog-missing おまかせの部品の数だけ呼ぶ乱数ヘルパー
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 4294967296;
}

/** アバター画面の状態と描画 */
class AvatarController {
  private readonly ctx: AppContext;
  private readonly body: HTMLElement;
  private closet: AvatarClosetDto | undefined;
  private parts: readonly AvatarPartDto[] = [];
  /** 身につけている装い（保存する装い） */
  private outfit: readonly string[] = [];
  /** 画面を開いたときの装い（元に戻す） */
  private initialOutfit: readonly string[] = [];
  private tryOnId: string | undefined;
  private selectedId: string | undefined;
  private category: CategoryKey = 'hair';
  /** いまのカテゴリで見た NEW（カテゴリを離れるときに保存する） */
  private readonly pendingSeen = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private stage: AvatarStageHandle | undefined;
  private overlay: StageOverlayHandle | undefined;
  private tabs: HTMLElement | undefined;
  private panel: HTMLElement | undefined;
  private disposed = false;
  /** 開いたときの決めポーズのタイマー */
  private introTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * 骨組みを作る。
   * @param ctx 画面コンテキスト
   */
  constructor(ctx: AppContext) {
    const log = logger.fn('constructor');
    this.ctx = ctx;
    this.body = h('div', { class: ['screen', 'avatar'], attrs: { 'data-testid': 'avatar', 'data-load': 'loading' } }, [h('p', { class: 'screen-message', text: 'アバターを読み込み中…' })]);
    log.exit(undefined);
  }

  /**
   * 本文を置き、データを読み込んで描く。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.avatar を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount');
    root.append(this.body);
    const loaded = await this.ctx.services.avatar.execute();
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!loaded.ok) {
      this.body.dataset.load = 'error';
      this.body.replaceChildren(h('p', { class: 'screen-message', text: loaded.error.message }));
      return log.fail(undefined, loaded.error.code);
    }
    this.closet = loaded.value;
    this.parts = loaded.value.parts;
    this.outfit = loaded.value.outfit;
    this.initialOutfit = loaded.value.outfit;
    if (loaded.value.needsSeenBaseline) void this.ctx.services.saveAvatar.execute({ outfit: this.outfit, seenPartIds: this.parts.filter((p) => p.owned).map((p) => p.id) });
    this.render();
    this.scheduleIntroEmote();
    log.exit(undefined);
  }

  /**
   * 開いてすぐ、決めポーズのエモートを1回出す。
   * @sideEffect タイマーを1つ予約する（unmount で取り消す）
   */
  private scheduleIntroEmote(): void {
    const log = logger.fn('scheduleIntroEmote');
    const emote = stageLookOf(this.outfit).emote;
    if (emote === undefined) return log.exit(undefined, '決めポーズなし');
    this.introTimer = setTimeout(() => this.stage?.playEmote(emote), 300);
    log.exit(undefined);
  }

  /**
   * 後始末する（未保存の装い・見た NEW を保存し、ステージを止める）。
   * @sideEffect 保存を1回呼ぶことがある。requestAnimationFrame と ResizeObserver を解除する
   */
  unmount(): void {
    const log = logger.fn('unmount');
    if (this.saveTimer !== undefined || this.pendingSeen.size > 0) this.flushSeen(true);
    this.disposed = true;
    if (this.introTimer !== undefined) clearTimeout(this.introTimer);
    this.stage?.destroy();
    this.stage = undefined;
    log.exit(undefined);
  }

  /** 表示用の装い（試着を重ねたもの） */
  private preview(): readonly string[] {
    return withTryOn(this.outfit, this.tryOnId);
  }

  /** 表示している装いに SSR の部品があるか */
  private hasSsr(): boolean {
    const log = logger.fn('hasSsr');
    const preview = this.preview();
    return log.exit(this.parts.some((p) => p.rarity === 'SSR' && preview.includes(p.id)));
  }

  /** 格子・チップに渡す入力 */
  private listInput(): PartListInput {
    return { parts: this.parts, outfit: this.outfit, preview: this.preview(), tryOnId: this.tryOnId, selectedId: this.selectedId, onPick: (p: AvatarPartDto): void => this.pick(p) };
  }

  /**
   * 画面全体（ステージ・操作の列・タブ・タブの中身）を描く。
   * @sideEffect 本文の DOM を作り直す
   */
  private render(): void {
    const log = logger.fn('render', { category: this.category });
    const closet = this.closet;
    if (closet === undefined) return log.exit(undefined);
    this.stage?.destroy();
    const look = stageLookOf(this.preview());
    this.stage = createAvatarStage({ stage: look, hasSsr: this.hasSsr(), reducedMotion: prefersReducedMotion(), onTap: (): void => this.onStageTap() });
    this.overlay = createStageOverlay({
      closet, parts: this.parts, outfit: this.preview(), tryOnId: this.tryOnId,
      onPose: (pose: AvatarPose): void => this.stage?.setPose(pose),
      onUndo: (): void => this.replaceOutfit(this.initialOutfit, '開いたときの服に戻しました'),
      onRandom: (): void => this.replaceOutfit(randomOutfitOf(this.parts, cryptoRandom, this.outfit), 'おまかせで着替えました'),
      onPhoto: (): void => void this.takePhoto(),
    });
    const stageBox = h('section', { class: 'avatar-stage', attrs: { 'aria-label': 'アバターのステージ' } }, [this.stage.element, this.overlay.element]);
    this.tabs = h('nav', { class: 'avatar-tabs', attrs: { role: 'tablist', 'aria-label': '着せ替えのカテゴリ' } });
    this.panel = h('div', { class: 'avatar-panel', attrs: { role: 'tabpanel', 'data-testid': 'avatar-panel' } });
    this.body.dataset.load = 'ready';
    this.body.replaceChildren(stageBox, this.overlay.actions, this.tabs, h('div', { class: 'avatar-scroll' }, [this.panel]));
    this.renderTabs();
    this.renderPanel();
    log.exit(undefined);
  }

  /**
   * カテゴリのタブ（絵文字＋名前＋NEW の数）を描く。
   * @sideEffect タブの DOM を作り直す
   */
  private renderTabs(): void {
    const log = logger.fn('renderTabs', { category: this.category });
    if (this.tabs === undefined) return log.exit(undefined);
    const buttons = CATEGORIES.map((c) => {
      const count = newCountOf(this.parts, slotsOfCategory(c));
      const button = h('button', {
        class: 'avatar-tab',
        attrs: { type: 'button', role: 'tab', 'aria-selected': c.key === this.category ? 'true' : 'false', 'data-testid': `avatar-tab-${c.key}` },
      }, [h('span', { class: 'avatar-tab__bubble' }, [createAvatarIcon(c.key, 26, 'avatar-tab__icon')]), h('span', { class: 'avatar-tab__label', text: c.label }),
        count > 0 ? h('span', { class: 'avatar-tab__new', text: `${count}`, attrs: { 'aria-label': `NEW ${count}` } }) : undefined]);
      button.addEventListener('click', () => this.selectCategory(c.key));
      return button;
    });
    this.tabs.replaceChildren(...buttons);
    this.tabs.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    log.exit(undefined);
  }

  /**
   * カテゴリを切り替える（試着はやめ、見た NEW を保存する）。
   * @param key カテゴリ
   * @sideEffect タブと中身を描き直す
   */
  private selectCategory(key: CategoryKey): void {
    setCorrelationId();
    const log = logger.fn('selectCategory', { key });
    if (key === this.category) return log.exit(undefined, '選択済み');
    this.flushSeen();
    this.category = key;
    this.tryOnId = undefined;
    this.selectedId = undefined;
    this.refreshStage();
    this.renderTabs();
    this.renderPanel();
    this.panel?.parentElement?.scrollTo({ top: 0 });
    log.exit(undefined);
  }

  /** いまのカテゴリの定義 */
  private categoryDef(): CategoryDef {
    return CATEGORIES.find((c) => c.key === this.category) ?? CATEGORIES[0] as CategoryDef;
  }

  /**
   * タブの中身を描く（見えている NEW を「見た」に入れる）。
   * @sideEffect タブの中身の DOM を作り直す
   */
  private renderPanel(): void {
    const log = logger.fn('renderPanel', { category: this.category });
    const closet = this.closet;
    if (closet === undefined || this.panel === undefined) return log.exit(undefined);
    const def = this.categoryDef();
    const input = this.listInput();
    /**
     * 地図を開く（地区ID があればその地区）。
     * @param districtId 地区ID
     */
    const goMap = (districtId?: string): void => this.ctx.router.navigate(districtId === undefined ? '#/map' : `#/map/${districtId}`);
    const children: (HTMLElement | undefined)[] = [];
    if (def.key === 'coord') children.push(createCoordPanel(closet.coords, { onWear: (c: AvatarCoordDto): void => this.wearCoord(c), onSave: (i: number): void => void this.saveCoord(i, this.outfit), onDelete: (i: number): void => void this.saveCoord(i, null) }));
    else {
      const selected = this.parts.find((p) => p.id === this.selectedId);
      if (selected !== undefined) children.push(createPartDetail(selected, input, { onStopTryOn: (): void => this.stopTryOn(), onUnequip: (p: AvatarPartDto): void => this.applyOutfit(unequipPart(this.outfit, p.id)), onGoMap: goMap }));
      if (def.topSlot !== undefined) {
        const top = def.topSlot;
        children.push(h('h3', { class: 'avatar-sub', text: def.topLabel ?? '' }), createPartGrid(top, input, (): void => undefined));
      }
      if (def.chipSlot !== undefined) children.push(createColorChips(def.chipSlot, def.chipLabel ?? '色', input));
      if (def.gridSlot === 'title') children.push(createTitleList(input, (): void => this.applyOutfit(clearSlot(this.outfit, 'title'))));
      else if (def.gridSlot !== undefined) {
        const slot = def.gridSlot;
        children.push(createPartGrid(slot, input, (): void => this.applyOutfit(clearSlot(this.outfit, slot))));
      }
      this.parts.filter((p) => p.isNew && slotsOfCategory(def).includes(p.slot)).forEach((p) => this.pendingSeen.add(p.id));
    }
    this.panel.replaceChildren(...children.filter((c): c is HTMLElement => c !== undefined));
    log.exit(undefined);
  }

  /**
   * 部品を押したとき。持っていれば身につける（身につけていて、はずせる枠ならはずす）。持っていなければ試着する。
   * @param part 部品
   * @sideEffect 装い・試着を変え、ステージと中身を描き直す。自動保存を予約する
   */
  private pick(part: AvatarPartDto): void {
    const log = logger.fn('pick', { id: part.id, owned: part.owned });
    this.selectedId = part.id;
    const emote = part.slot === 'emote' ? (splitPartId(part.id)?.style as EmoteStyle | undefined) : undefined;
    if (!part.owned) {
      this.tryOnId = this.tryOnId === part.id && emote === undefined ? undefined : part.id;
      // 試着中の部品をもう一度押したら、試着をやめて詳しい情報も閉じる（「試着をやめる」と同じ）
      if (this.tryOnId === undefined) this.selectedId = undefined;
      this.refreshAll();
      if (emote !== undefined) this.stage?.playEmote(emote);
      else if (this.tryOnId !== undefined) this.stage?.sparkle(part.rarity);
      return log.exit(undefined, '試着');
    }
    if (emote !== undefined) {
      if (!this.outfit.includes(part.id)) this.applyOutfit(equipPart(this.outfit, part.id).outfit);
      else this.refreshAll();
      this.stage?.playEmote(emote);
      return log.exit(undefined, 'エモート');
    }
    if (this.tryOnId !== undefined && slotOfPartId(this.tryOnId) === part.slot) this.tryOnId = undefined;
    if (this.outfit.includes(part.id)) return log.exit(this.applyOutfit(unequipPart(this.outfit, part.id)), 'はずす');
    const result = equipPart(this.outfit, part.id);
    if (result.replaced !== undefined) {
      const name = this.parts.find((p) => p.id === result.replaced)?.name ?? '';
      this.ctx.toast.show(`置けるのは3つまで。${name}と入れかえました`);
    }
    this.applyOutfit(result.outfit);
    this.stage?.sparkle(part.rarity);
    log.exit(undefined);
  }

  /**
   * ステージを押したとき。決めポーズがあればそのエモート、なければジャンプ。
   * @sideEffect ステージの動きを変える
   */
  private onStageTap(): void {
    setCorrelationId();
    const log = logger.fn('onStageTap');
    const emote = stageLookOf(this.preview()).emote;
    if (emote === undefined) this.stage?.setPose('jump', true);
    else this.stage?.playEmote(emote);
    log.exit(undefined);
  }

  /**
   * 記念撮影する（いまのステージに額と名前を付けて PNG で保存させる）。
   * @sideEffect 撮影の光を出し、画像のダウンロードを始める。結果をトーストで伝える
   */
  private async takePhoto(): Promise<void> {
    setCorrelationId();
    const log = logger.fn('takePhoto');
    const source = this.stage?.capture();
    const closet = this.closet;
    if (source === undefined || closet === undefined) return log.fail(undefined, 'ステージが無い');
    const title = this.parts.find((p) => p.slot === 'title' && this.preview().includes(p.id))?.name;
    const photo = composePhoto(source, title === undefined ? { nickname: closet.nickname } : { nickname: closet.nickname, title });
    const saved = photo === undefined ? false : await savePhoto(photo, 'kayoimachi-avatar.png');
    if (this.disposed) return log.exit(undefined);
    this.ctx.toast.show(saved ? '写真を保存しました' : '写真を保存できませんでした', { kind: saved ? 'success' : 'error' });
    log.exit(undefined);
  }

  /**
   * 装いを変えて描き直し、自動保存を予約する。
   * @param outfit 新しい装い
   * @sideEffect ステージ・中身を描き直し、保存を予約する
   */
  private applyOutfit(outfit: readonly string[]): void {
    const log = logger.fn('applyOutfit', { count: outfit.length });
    if (sameOutfit(outfit, this.outfit)) {
      this.refreshAll();
      return log.exit(undefined, '変化なし');
    }
    this.outfit = outfit;
    this.refreshAll();
    this.scheduleSave();
    log.exit(undefined);
  }

  /**
   * 装いをまるごと替える（元に戻す・おまかせ・マイコーデ）。
   * @param outfit 新しい装い
   * @param message 知らせる文言
   * @sideEffect 試着をやめ、装いを変える
   */
  private replaceOutfit(outfit: readonly string[], message: string): void {
    setCorrelationId();
    const log = logger.fn('replaceOutfit', { count: outfit.length });
    this.tryOnId = undefined;
    this.selectedId = undefined;
    this.applyOutfit(outfit);
    this.stage?.setPose('jump', true);
    this.stage?.sparkle('N');
    this.ctx.toast.show(message, { kind: 'success' });
    log.exit(undefined);
  }

  /**
   * 試着をやめる（詳しい情報も閉じて、部品の一覧に戻る）。
   * @sideEffect ステージと中身を描き直す
   */
  private stopTryOn(): void {
    const log = logger.fn('stopTryOn', { tryOnId: this.tryOnId });
    this.tryOnId = undefined;
    this.selectedId = undefined;
    this.refreshAll();
    log.exit(undefined);
  }

  /**
   * ステージ・上に重ねた表示・タブの中身を描き直す（スクロール位置は保つ）。
   * @sideEffect DOM を描き直す
   */
  private refreshAll(): void {
    const log = logger.fn('refreshAll');
    const scroller = this.panel?.parentElement;
    const top = scroller?.scrollTop ?? 0;
    this.refreshStage();
    this.renderPanel();
    if (scroller !== undefined && scroller !== null) scroller.scrollTop = top;
    log.exit(undefined);
  }

  /**
   * ステージと上に重ねた表示を、いまの装い（試着つき）にする。
   * @sideEffect ステージの絵と上の表示を変える
   */
  private refreshStage(): void {
    const log = logger.fn('refreshStage', { tryOnId: this.tryOnId });
    const preview = this.preview();
    this.stage?.update(stageLookOf(preview), this.hasSsr());
    this.overlay?.update(preview, this.tryOnId, this.parts);
    log.exit(undefined);
  }

  /**
   * 少し待ってから装いを保存する（続けて選んだら最後の1回だけ）。
   * @sideEffect タイマーを予約する
   */
  private scheduleSave(): void {
    const log = logger.fn('scheduleSave');
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer);
    this.overlay?.setSaveState('saving');
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.saveOutfit();
    }, SAVE_DELAY_MS);
    log.exit(undefined);
  }

  /**
   * 装いを保存する（持っていない部品は application 側で外される）。
   * @sideEffect services.saveAvatar を呼ぶ。失敗はトーストで伝える
   */
  private async saveOutfit(): Promise<void> {
    setCorrelationId();
    const log = logger.fn('saveOutfit', { count: this.outfit.length });
    const saved = await this.ctx.services.saveAvatar.execute({ outfit: this.outfit });
    if (this.disposed) return log.exit(undefined);
    if (!saved.ok) {
      this.overlay?.setSaveState('error');
      this.ctx.toast.show(saved.error.message, { kind: 'error' });
      return log.fail(undefined, saved.error.code);
    }
    this.overlay?.setSaveState('saved');
    log.exit(undefined);
  }

  /**
   * マイコーデの枠へ保存する（null なら空にする）。
   * @param index 枠の番号
   * @param partIds 保存する装い
   * @sideEffect services.saveAvatar を呼び、マイコーデを読み直して描き直す
   */
  private async saveCoord(index: number, partIds: readonly string[] | null): Promise<void> {
    setCorrelationId();
    const log = logger.fn('saveCoord', { index, clear: partIds === null });
    const saved = await this.ctx.services.saveAvatar.execute({ outfit: this.outfit, coord: { index, partIds } });
    if (this.disposed) return log.exit(undefined);
    if (!saved.ok) {
      this.ctx.toast.show(saved.error.message, { kind: 'error' });
      return log.fail(undefined, saved.error.code);
    }
    const reloaded = await this.ctx.services.avatar.execute();
    if (this.disposed || !reloaded.ok || this.closet === undefined) return log.exit(undefined);
    this.closet = { ...this.closet, coords: reloaded.value.coords };
    this.renderPanel();
    this.ctx.toast.show(partIds === null ? `コーデ ${index + 1} を消しました` : `コーデ ${index + 1} に保存しました`, { kind: 'success' });
    log.exit(undefined);
  }

  /**
   * マイコーデを着る。
   * @param coord マイコーデ
   * @sideEffect 装いを替える
   */
  private wearCoord(coord: AvatarCoordDto): void {
    const log = logger.fn('wearCoord', { index: coord.index });
    if (coord.partIds !== undefined) this.replaceOutfit(coord.partIds, `コーデ ${coord.index + 1} に着替えました`);
    log.exit(undefined);
  }

  /**
   * いまのカテゴリで見た NEW を保存し、手元の NEW の印を消す。保存待ちの装いも同じ1回で保存する（保存どうしが追い越さないように）。
   * @param force 見た NEW が無くても、保存待ちの装いを保存する
   * @sideEffect services.saveAvatar を呼ぶことがある。保存待ちのタイマーを取り消す
   */
  private flushSeen(force = false): void {
    const log = logger.fn('flushSeen', { count: this.pendingSeen.size, force });
    if (this.pendingSeen.size === 0 && !force) return log.exit(undefined);
    const seen = [...this.pendingSeen];
    this.pendingSeen.clear();
    this.parts = this.parts.map((p) => (p.isNew && seen.includes(p.id) ? { ...p, isNew: false } : p));
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.overlay?.setSaveState('saved');
    }
    void this.ctx.services.saveAvatar.execute({ outfit: this.outfit, seenPartIds: seen });
    log.exit(undefined);
  }
}
