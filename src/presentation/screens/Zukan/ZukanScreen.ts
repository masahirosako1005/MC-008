/**
 * @file 図鑑画面（presentation/screens/Zukan 層。ルート '#/zukan'・'#/zukan/:districtId'）
 * 地区タブ、地区の見出し（地区の色・Lv・通った回数・最近いつ・次の目標）、収集カード風のタイル格子を出す（CLAUDE.md 6.5、wireframes/05_zukan）。基準 B・C。
 * 達成率（％や「全n件中m件」）は出さない。通うほどカードが育つ（なじみ度・季節の印）ことで「また行きたい」を作る。
 * タイルを押すとスポット詳細へ、未発見の「？」は見つけ方だけを案内する。
 */
import '@/presentation/screens/Zukan/ZukanScreen.css';
import type { ZukanDistrictDto, ZukanDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { ModalHandle } from '@/Common/ui/Modal';
import { createTopBar } from '@/Common/ui/TopBar';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { fadeLabel } from '@/presentation/shared/labels';
import { createDistrictTabs } from '@/presentation/screens/Zukan/DistrictTabs';
import { openCardPreview } from '@/presentation/screens/Zukan/CardPreview';
import { createRarityLegend } from '@/presentation/screens/Zukan/RarityLegend';
import { createSpotGrid } from '@/presentation/screens/Zukan/SpotGrid';
import { levelDescription, shortLastVisit, UNKNOWN_TILE_HINT, ZUKAN_FOOTNOTE } from '@/presentation/screens/Zukan/zukanModel';

const logger = createLogger('presentation/screens/Zukan/ZukanScreen');

/** 成長段階の最大値（Lv の点の数 − 1） */
const MAX_LEVEL = 3;

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

/**
 * 数字1つ分の欄（大きな値＋小さな説明）を作る。
 * @param value 値の要素または文字列
 * @param caption 説明
 * @returns 要素
 */
function createStat(value: HTMLElement | string, caption: string): HTMLElement {
  const log = logger.fn('createStat', { caption });
  const valueEl = typeof value === 'string' ? h('span', { class: 'zukan-hero__value', text: value }) : value;
  return log.exit(h('div', { class: 'zukan-hero__stat' }, [valueEl, h('span', { class: 'zukan-hero__caption', text: caption })]));
}

/**
 * 成長段階の点（●●○○）を作る。
 * @param level 成長段階 0..3
 * @returns 要素（読み上げは 'Lv2'）
 */
function createLevelPips(level: number): HTMLElement {
  const log = logger.fn('createLevelPips', { level });
  const pips = Array.from({ length: MAX_LEVEL + 1 }, (_, i) => h('span', { class: 'zukan-hero__pip', dataset: { on: i <= level ? '1' : '0' } }));
  return log.exit(
    h('span', { class: ['zukan-hero__value', 'zukan-hero__level'], attrs: { role: 'img', 'aria-label': `Lv${level}` } }, [
      h('span', { class: 'zukan-hero__lv', attrs: { 'aria-hidden': 'true' }, text: `Lv${level}` }),
      h('span', { class: 'zukan-hero__pips', attrs: { 'aria-hidden': 'true' } }, pips),
    ]),
  );
}

/**
 * 地区の見出し（地区の色の帯・名前・テーマ・色あせ・Lv・通った回数・最近・次の目標）を作る。
 * @param district 選んでいる地区
 * @returns 見出しの要素
 */
function createDistrictHero(district: ZukanDistrictDto): HTMLElement {
  const log = logger.fn('createDistrictHero', { districtId: district.id, level: district.level, fade: district.fade.kind });
  const fade = fadeLabel(district.fade);
  const count = h('span', { class: 'zukan-hero__value' }, [h('b', { class: 'zukan-hero__big', text: String(district.visitCount) }), '回']);
  const hero = h('section', { class: 'zukan-hero', attrs: { 'data-testid': 'zukan-head' }, dataset: { fade: district.fade.kind }, style: { '--district': district.color } }, [
    h('div', { class: 'zukan-hero__band' }, [
      h('span', { class: 'zukan-hero__theme', text: district.theme }),
      fade === undefined ? undefined : h('span', { class: 'zukan-hero__fade' }, [createIcon('fade'), fade]),
    ]),
    h('h2', { class: 'zukan-hero__name', text: district.name }),
    h('div', { class: 'zukan-hero__stats', attrs: { 'data-testid': 'zukan-summary' } }, [
      createStat(count, '通った回数'),
      createStat(createLevelPips(district.level), levelDescription(district.level)),
      createStat(shortLastVisit(district), '最近'),
    ]),
    h('p', { class: 'zukan-hero__goal', attrs: { 'data-testid': 'zukan-goal' } }, [
      h('span', { class: 'zukan-hero__goal-label', text: '次の目標' }),
      h('span', { class: 'zukan-hero__goal-text', text: district.nextGoalText }),
    ]),
  ]);
  return log.exit(hero);
}

/** 図鑑の読込・描画・遷移を受け持つ */
class ZukanController {
  private readonly ctx: AppContext;
  private readonly districtId: string | undefined;
  private readonly body: HTMLElement;
  /** カードの絵の後始末 */
  private destroyArts: (() => void) | undefined;
  /** 画面を離れた（以降の非同期結果は捨てる） */
  private disposed = false;
  /** 開いているカードの拡大プレビュー（画面を離れるときに閉じる） */
  private preview: ModalHandle | undefined;

  /**
   * 画面の骨組み（本文）を作る。
   * @param ctx 画面コンテキスト
   * @param districtId 表示する地区（省略時は先頭の地区）
   */
  constructor(ctx: AppContext, districtId: string | undefined) {
    const log = logger.fn('constructor', { districtId });
    this.ctx = ctx;
    this.districtId = districtId;
    this.body = h('div', { class: ['screen-scroll', 'zukan__body'], attrs: { 'data-testid': 'zukan', 'data-load': 'loading' } });
    log.exit(undefined);
  }

  /**
   * 上部バーと本文を置き、図鑑を読み込んで描く。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.zukan を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount', { districtId: this.districtId });
    root.append(createTopBar({ title: '図鑑', subtitle: '通うほど育つ、自分だけのスポット帳' }), this.body);
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
   * 図鑑を描く（地区タブ → 地区の見出し → カード格子 → 一言）。カードの絵は DOM に入れてから描く。
   * @param dto 図鑑
   * @sideEffect 本文の中身を差し替え、canvas を追加する
   */
  private render(dto: ZukanDto): void {
    const log = logger.fn('render', { districtId: dto.district.id, tiles: dto.tiles.length });
    this.destroyArts?.();
    const tabs = createDistrictTabs({ districts: dto.districts, selectedId: dto.district.id, onSelect: (id): void => this.selectDistrict(id) });
    const grid = createSpotGrid({
      tiles: dto.tiles,
      onOpenSpot: (spotId): void => this.ctx.router.navigate(`#/spot/${spotId}`),
      onUnknown: (): void => this.ctx.toast.show(UNKNOWN_TILE_HINT, { kind: 'info' }),
      onPreview: (tile): void => {
        this.preview = openCardPreview(tile, (spotId): void => this.ctx.router.navigate(`#/spot/${spotId}`));
      },
    });
    this.body.replaceChildren(tabs, createDistrictHero(dto.district), createRarityLegend(dto.tiles), grid.element, h('p', { class: 'zukan__footnote', text: ZUKAN_FOOTNOTE }));
    // 絵は CSS の --district（data-district-id から）で地区色を引くので、地区ID を付けてから描く
    this.body.dataset.districtId = dto.district.id;
    this.destroyArts = grid.mountArts();
    this.body.dataset.load = 'ready';
    this.body.dataset.fade = dto.district.fade.kind;
    log.exit(undefined);
  }

  /**
   * 地区タブを切り替える（URL を置き換えて画面を作り直す。履歴は積まない）。
   * @param districtId 選ばれた地区
   * @sideEffect ルーター遷移する
   */
  private selectDistrict(districtId: string): void {
    const log = logger.fn('selectDistrict', { districtId });
    if (!this.disposed) this.ctx.router.navigate(`#/zukan/${districtId}`, { replace: true });
    log.exit(undefined);
  }
}
