/**
 * @file 図鑑画面（presentation/screens/Zukan 層。ルート '#/zukan'・'#/zukan/:districtId'）
 * 最上部の絞り込み（地区・状態のプルダウン1段）、手持ち枚数の細い1行、収集カード風のタイル格子を出す（CLAUDE.md 6.5、wireframes/05_zukan）。基準 B・C。
 * 2026-11-09 ユーザー指示: 地区ごとのタブ分けをやめ、すべての地区のカードを1つの格子に出して「地区」と「状態」で絞り込む。
 * 同日「タブがでかいのでプルダウンに。地区の見出し（テーマ・回数・Lv・最近・次の目標）は削っていい。開いたらすぐ写真が見えるのが自然」で、
 * 絞り込みをプルダウンにし、地区の見出し・レジェンドの一言・未発見の案内をやめた（地区の数字はマイ街で見られる）。
 * 末尾の一言（「通うほどカードが育つ。全部そろえなくても街は育つ。」）は出さない。
 * 達成率（％や「全n件中m件」）は出さない。タイルを押すと拡大プレビュー（→ 発見済み・訪問済みはスポット詳細へ）。
 * 絞り込みは画面を作り直さずに格子だけ描き直す。最後の絞り込みはメモリに覚え、スポット詳細から戻っても保つ（URL の地区が優先）。
 * 2026-11-10 ユーザー指示「図鑑/記録の機能に。いつ行ったか、過去の写真との紐づけ、思い出などを回想できるように。図鑑画面とは切り替えられるように（情報が多いので）」で、
 * 最上部に切替（図鑑／記録）を置いた。記録は訪問の年表で、1件を押すとその回の思い出（自分の写真・メモ）を付けられる。最後に見ていた表示もメモリに覚える。
 */
import '@/presentation/screens/Zukan/ZukanScreen.css';
import type { ZukanDto } from '@/application/dto/Dto';
import type { SaveVisitMemoryInput, VisitLogDto, VisitLogEntryDto } from '@/application/dto/VisitLogDto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import type { ModalHandle } from '@/Common/ui/Modal';
import { createTopBar } from '@/Common/ui/TopBar';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { openCardPreview } from '@/presentation/screens/Zukan/CardPreview';
import { createRarityLegend } from '@/presentation/screens/Zukan/RarityLegend';
import { createSpotGrid } from '@/presentation/screens/Zukan/SpotGrid';
import { openMemoryEditor } from '@/presentation/screens/Zukan/MemoryEditor';
import { createEmptyMark, createVisitLogView } from '@/presentation/screens/Zukan/VisitLogView';
import type { ZukanMode } from '@/presentation/screens/Zukan/visitLogModel';
import { createZukanFilters } from '@/presentation/screens/Zukan/ZukanFilters';
import { createZukanModeSwitch } from '@/presentation/screens/Zukan/ZukanModeSwitch';
import { EMPTY_FILTER_TEXT, filterTiles, UNKNOWN_TILE_HINT, validDistrictFilter } from '@/presentation/screens/Zukan/zukanModel';
import type { ZukanFilter } from '@/presentation/screens/Zukan/zukanModel';

const logger = createLogger('presentation/screens/Zukan/ZukanScreen');

/** 最後に使った絞り込み（画面を離れても保つ。アプリを読み込み直すと「すべて」に戻る） */
let lastFilter: ZukanFilter = { status: 'all' };

/** 最後に見ていた表示（図鑑／記録。画面を離れても保つ。URL に地区があるときは図鑑） */
let lastMode: ZukanMode = 'zukan';

/**
 * 図鑑画面を作る。
 * @param ctx 画面コンテキスト
 * @param params ルートのパラメータ（districtId は任意。ルーターで検証済み）
 * @returns 画面
 */
export function createZukanScreen(ctx: AppContext, params: Readonly<Record<string, string>>): Screen {
  const log = logger.fn('createZukanScreen', { districtId: params.districtId });
  const controller = new ZukanController(ctx, params.districtId);
  const screen: Screen = {
    mount: (root: HTMLElement): Promise<void> => controller.mount(root),
    unmount: (): void => controller.unmount(),
  };
  return log.exit(screen);
}

/** 図鑑の読込・描画・絞り込み・遷移を受け持つ */
class ZukanController {
  private readonly ctx: AppContext;
  private readonly districtId: string | undefined;
  private readonly body: HTMLElement;
  /** 絞り込みより下（手持ち枚数・格子）。絞り込みを変えるとここだけ描き直す */
  private readonly content: HTMLElement;
  /** 読み込んだ図鑑 */
  private dto: ZukanDto | undefined;
  /** いまの表示（図鑑／記録） */
  private mode: ZukanMode;
  /** 読み込んだ記録（記録をはじめて開いたときに読む。思い出を保存したら読み直す） */
  private logDto: VisitLogDto | undefined;
  /** 切替の選択中を差し替える */
  private updateMode: ((mode: ZukanMode) => void) | undefined;
  /** 図鑑の絞り込みの要素（記録では隠す） */
  private filtersElement: HTMLElement | undefined;
  /** いまの絞り込み */
  private filter: ZukanFilter = lastFilter;
  /** 絞り込みの表示を差し替える */
  private updateFilters: ((filter: ZukanFilter) => void) | undefined;
  /** カードの絵の後始末 */
  private destroyArts: (() => void) | undefined;
  /** 画面を離れた（以降の非同期結果は捨てる） */
  private disposed = false;
  /** 開いているカードの拡大プレビュー（画面を離れるときに閉じる） */
  private preview: ModalHandle | undefined;

  /**
   * 画面の骨組み（本文）を作る。
   * @param ctx 画面コンテキスト
   * @param districtId 最初に絞り込む地区（省略時は最後に使った絞り込み）
   */
  constructor(ctx: AppContext, districtId: string | undefined) {
    const log = logger.fn('constructor', { districtId });
    this.ctx = ctx;
    this.districtId = districtId;
    this.mode = districtId === undefined ? lastMode : 'zukan';
    this.body = h('div', { class: ['screen-scroll', 'zukan__body'], attrs: { 'data-testid': 'zukan', 'data-load': 'loading' } });
    this.content = h('div', { class: 'zukan__content', attrs: { 'aria-live': 'polite' } });
    log.exit(undefined);
  }

  /**
   * 上部バーと本文を置き、図鑑を読み込んで描く。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.zukan を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount', { districtId: this.districtId });
    root.append(createTopBar({ title: '図鑑' }), this.body);
    await this.load();
    log.exit(undefined);
  }

  /**
   * 後始末する（カードの絵の監視を止め、以降の非同期結果を捨てる）。
   * @sideEffect ResizeObserver を解除し、開いているカードの拡大プレビューを閉じる
   */
  unmount(): void {
    const log = logger.fn('unmount', { districtId: this.districtId });
    this.disposed = true;
    this.destroyArts?.();
    this.destroyArts = undefined;
    this.preview?.close();
    this.preview = undefined;
    log.exit(undefined);
  }

  /**
   * 図鑑を読み込んで描く。失敗したらトーストと案内文を出す。
   * @sideEffect services.zukan を呼び、本文を描き直す
   */
  private async load(): Promise<void> {
    const log = logger.fn('load', { districtId: this.districtId });
    const result = await this.ctx.services.zukan.execute(this.districtId === undefined ? {} : { districtId: this.districtId });
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!result.ok) {
      this.body.dataset.load = 'error';
      this.ctx.toast.show(result.error.message, { kind: 'error' });
      this.body.replaceChildren(createEmptyMark('card', '読み込み失敗', 'zukan-error'));
      return log.fail(undefined, result.error.code);
    }
    this.render(result.value);
    log.exit(undefined);
  }

  /**
   * 図鑑を描く（絞り込み → 手持ち枚数・格子）。URL の地区があれば最初の絞り込みにする。
   * @param dto 図鑑
   * @sideEffect 本文の中身を差し替える
   */
  private render(dto: ZukanDto): void {
    const log = logger.fn('render', { tiles: dto.tiles.length, selectedDistrictId: dto.selectedDistrictId });
    this.dto = dto;
    const districtIds = dto.districts.map((d) => d.id);
    const wanted = dto.selectedDistrictId ?? this.filter.districtId;
    this.filter = { ...this.filter, districtId: validDistrictFilter(wanted, districtIds) };
    const filters = createZukanFilters({ districts: dto.districts, filter: this.filter, onChange: (filter): void => this.applyFilter(filter) });
    this.updateFilters = filters.update;
    this.filtersElement = filters.element;
    const modeSwitch = createZukanModeSwitch(this.mode, (mode): void => this.applyMode(mode));
    this.updateMode = modeSwitch.update;
    this.body.replaceChildren(h('div', { class: 'zukan-head' }, [modeSwitch.element, filters.element]), this.content);
    this.renderMode();
    this.body.dataset.load = 'ready';
    log.exit(undefined);
  }

  /**
   * 表示（図鑑／記録）を切り替える（画面は作り直さない）。
   * @param mode 新しい表示
   * @sideEffect 切替の選択中と本文の下側を差し替え、最後の表示を覚える
   */
  private applyMode(mode: ZukanMode): void {
    const log = logger.fn('applyMode', { mode });
    if (this.disposed) return log.exit(undefined, '画面を離れた');
    this.mode = mode;
    lastMode = mode;
    this.updateMode?.(mode);
    this.body.scrollTop = 0;
    this.renderMode();
    log.exit(undefined);
  }

  /**
   * いまの表示に合わせて本文の下側を描く（図鑑＝格子、記録＝年表。絞り込みは図鑑だけ）。
   * @sideEffect 本文の下側を差し替える。記録は未読込なら読み込む
   */
  private renderMode(): void {
    const log = logger.fn('renderMode', { mode: this.mode });
    this.body.dataset.mode = this.mode;
    if (this.filtersElement !== undefined) this.filtersElement.hidden = this.mode !== 'zukan';
    if (this.mode === 'zukan') this.renderContent();
    else if (this.logDto === undefined) void this.loadLog();
    else this.renderLog(this.logDto);
    log.exit(undefined);
  }

  /**
   * 記録を読み込んで描く。失敗したらトーストと案内文を出す。
   * @sideEffect services.visitLog を呼び、本文の下側を描き直す
   */
  private async loadLog(): Promise<void> {
    const log = logger.fn('loadLog');
    const result = await this.ctx.services.visitLog.execute();
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!result.ok) {
      this.ctx.toast.show(result.error.message, { kind: 'error' });
      if (this.mode === 'log') this.content.replaceChildren(createEmptyMark('calendar', '読み込み失敗', 'log-error'));
      return log.fail(undefined, result.error.code);
    }
    this.logDto = result.value;
    if (this.mode === 'log') this.renderLog(result.value);
    log.exit(undefined);
  }

  /**
   * 記録（訪問の年表）を描く。1件を押すと思い出の編集を開く。
   * @param dto 記録
   * @sideEffect 本文の下側を差し替え、スポットの絵を追加する
   */
  private renderLog(dto: VisitLogDto): void {
    const log = logger.fn('renderLog', { entries: dto.entries.length });
    this.destroyArts?.();
    this.destroyArts = undefined;
    delete this.body.dataset.districtId;
    delete this.body.dataset.fade;
    const view = createVisitLogView({ dto, onOpen: (entry): void => this.openMemory(entry, dto) });
    this.content.replaceChildren(view.element);
    this.destroyArts = view.mountArts();
    log.exit(undefined);
  }

  /**
   * 思い出の編集を開く。
   * @param entry 押された記録
   * @param dto 記録（上限の値に使う）
   * @sideEffect 画面にモーダルを出す
   */
  private openMemory(entry: VisitLogEntryDto, dto: VisitLogDto): void {
    const log = logger.fn('openMemory', { spotId: entry.spotId, localDate: entry.localDate });
    this.preview = openMemoryEditor({
      entry,
      noteMax: dto.noteMax,
      photoMaxChars: dto.photoMaxChars,
      onSave: (input): void => void this.saveMemory(input),
      onOpenSpot: (spotId): void => this.ctx.router.navigate(`#/spot/${spotId}`),
      onError: (message): void => this.ctx.toast.show(message, { kind: 'error' }),
    });
    log.exit(undefined);
  }

  /**
   * 思い出を保存し、記録を読み直して描く。失敗したらトーストで知らせる。
   * @param input 保存する内容（変えた項目だけ）
   * @sideEffect services.saveVisitMemory を呼び、記録を読み直す
   */
  private async saveMemory(input: SaveVisitMemoryInput): Promise<void> {
    const log = logger.fn('saveMemory', { spotId: input.spotId, localDate: input.localDate });
    const result = await this.ctx.services.saveVisitMemory.execute(input);
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!result.ok) {
      this.ctx.toast.show(result.error.message, { kind: 'error' });
      return log.fail(undefined, result.error.code);
    }
    this.ctx.toast.show('保存しました', { kind: 'success' });
    await this.loadLog();
    log.exit(undefined);
  }

  /**
   * 絞り込みを変えて、格子だけを描き直す（画面は作り直さない＝フォーカスとスクロールを保つ）。
   * @param filter 新しい絞り込み
   * @sideEffect 絞り込みの表示と本文の下側を差し替え、最後の絞り込みを覚える
   */
  private applyFilter(filter: ZukanFilter): void {
    const log = logger.fn('applyFilter', { districtId: filter.districtId, status: filter.status });
    if (this.disposed) return log.exit(undefined, '画面を離れた');
    this.filter = filter;
    this.updateFilters?.(filter);
    this.renderContent();
    log.exit(undefined);
  }

  /**
   * 絞り込みより下（手持ち枚数の1行・格子、または空の案内）を描く。カードの絵は DOM に入れてから描く。
   * @sideEffect 本文の下側を差し替え、canvas を追加する
   */
  private renderContent(): void {
    const dto = this.dto;
    const log = logger.fn('renderContent', { districtId: this.filter.districtId, status: this.filter.status });
    if (dto === undefined) return log.exit(undefined, '未読込');
    if (this.mode !== 'zukan') return log.exit(undefined, '記録を表示中');
    lastFilter = this.filter;
    this.destroyArts?.();
    this.destroyArts = undefined;
    const districtId = this.filter.districtId;
    const inDistrict = filterTiles(dto.tiles, { districtId, status: 'all' });
    const shown = filterTiles(inDistrict, { districtId, status: this.filter.status });
    const district = districtId === undefined ? undefined : dto.districts.find((d) => d.id === districtId);
    const legend = createRarityLegend(inDistrict);
    const grid = createSpotGrid({
      tiles: shown,
      headExtra: legend,
      districts: dto.districts,
      onOpenSpot: (spotId): void => this.ctx.router.navigate(`#/spot/${spotId}`),
      onUnknown: (): void => this.ctx.toast.show(UNKNOWN_TILE_HINT, { kind: 'info' }),
      onPreview: (tile): void => {
        this.preview = openCardPreview(tile, (spotId): void => this.ctx.router.navigate(`#/spot/${spotId}`));
      },
    });
    // 手持ち枚数は最初の見出しと同じ行に入れる（カードを上に寄せる）。0枚のときは手持ち枚数の下に空の印（線の絵＋1語）
    const parts: HTMLElement[] = shown.length === 0 ? [h('div', { class: 'zukan-section__head' }, [legend]), createEmptyMark('card', EMPTY_FILTER_TEXT, 'zukan-empty')] : [grid.element];
    this.content.replaceChildren(...parts);
    // 絵は CSS の --district（カードの data-district-id から）で地区色を引く。地区で絞ったときは本文にも付ける（色あせ表現・地区札の省略に使う）
    if (district === undefined) {
      delete this.body.dataset.districtId;
      delete this.body.dataset.fade;
    } else {
      this.body.dataset.districtId = district.id;
      this.body.dataset.fade = district.fadeKind;
    }
    this.body.dataset.status = this.filter.status;
    if (shown.length > 0) this.destroyArts = grid.mountArts();
    log.exit(undefined);
  }
}
