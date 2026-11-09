/**
 * @file 図鑑画面（presentation/screens/Zukan 層。ルート '#/zukan'・'#/zukan/:districtId'）
 * 最上部の絞り込み（地区・状態のプルダウン1段）、手持ち枚数の細い1行、収集カード風のタイル格子を出す（CLAUDE.md 6.5、wireframes/05_zukan）。基準 B・C。
 * 2026-11-09 ユーザー指示: 地区ごとのタブ分けをやめ、すべての地区のカードを1つの格子に出して「地区」と「状態」で絞り込む。
 * 同日「タブがでかいのでプルダウンに。地区の見出し（テーマ・回数・Lv・最近・次の目標）は削っていい。開いたらすぐ写真が見えるのが自然」で、
 * 絞り込みをプルダウンにし、地区の見出し・レジェンドの一言・未発見の案内をやめた（地区の数字はマイ街で見られる）。
 * 末尾の一言（「通うほどカードが育つ。全部そろえなくても街は育つ。」）は出さない。
 * 達成率（％や「全n件中m件」）は出さない。タイルを押すと拡大プレビュー（→ 発見済み・訪問済みはスポット詳細へ）。
 * 絞り込みは画面を作り直さずに格子だけ描き直す。最後の絞り込みはメモリに覚え、スポット詳細から戻っても保つ（URL の地区が優先）。
 */
import '@/presentation/screens/Zukan/ZukanScreen.css';
import type { ZukanDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import type { ModalHandle } from '@/Common/ui/Modal';
import { createTopBar } from '@/Common/ui/TopBar';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { openCardPreview } from '@/presentation/screens/Zukan/CardPreview';
import { createRarityLegend } from '@/presentation/screens/Zukan/RarityLegend';
import { createSpotGrid } from '@/presentation/screens/Zukan/SpotGrid';
import { createZukanFilters } from '@/presentation/screens/Zukan/ZukanFilters';
import { EMPTY_FILTER_TEXT, filterTiles, UNKNOWN_TILE_HINT, validDistrictFilter } from '@/presentation/screens/Zukan/zukanModel';
import type { ZukanFilter } from '@/presentation/screens/Zukan/zukanModel';

const logger = createLogger('presentation/screens/Zukan/ZukanScreen');

/** 最後に使った絞り込み（画面を離れても保つ。アプリを読み込み直すと「すべて」に戻る） */
let lastFilter: ZukanFilter = { status: 'all' };

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
    root.append(createTopBar({ title: '図鑑', subtitle: '通うほど育つ、自分だけのクエスト帳' }), this.body);
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
      this.body.replaceChildren(h('p', { class: 'screen-message', text: '図鑑を表示できませんでした。' }));
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
    this.body.replaceChildren(filters.element, this.content);
    this.renderContent();
    this.body.dataset.load = 'ready';
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
    lastFilter = this.filter;
    this.destroyArts?.();
    this.destroyArts = undefined;
    const districtId = this.filter.districtId;
    const inDistrict = filterTiles(dto.tiles, { districtId, status: 'all' });
    const shown = filterTiles(inDistrict, { districtId, status: this.filter.status });
    const district = districtId === undefined ? undefined : dto.districts.find((d) => d.id === districtId);
    const grid = createSpotGrid({
      tiles: shown,
      districts: dto.districts,
      onOpenSpot: (spotId): void => this.ctx.router.navigate(`#/spot/${spotId}`),
      onUnknown: (): void => this.ctx.toast.show(UNKNOWN_TILE_HINT, { kind: 'info' }),
      onPreview: (tile): void => {
        this.preview = openCardPreview(tile, (spotId): void => this.ctx.router.navigate(`#/spot/${spotId}`));
      },
    });
    const parts: HTMLElement[] = [
      createRarityLegend(inDistrict),
      shown.length === 0 ? h('p', { class: ['screen-message', 'zukan__empty'], attrs: { 'data-testid': 'zukan-empty' }, text: EMPTY_FILTER_TEXT }) : grid.element,
    ];
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
