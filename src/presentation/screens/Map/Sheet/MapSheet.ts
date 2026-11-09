/**
 * @file 地図下シート（presentation/screens/Map/Sheet 層）
 * 3段階（CLAUDE.md 6.3、wireframes/03_sheet）:
 * - つまみ: いちばん近いスポット（名前 or ？・距離・状態。チェックインできる範囲（80m）なら「チェックイン」）と、いちばん強い再訪理由1件
 * - 半分: 近隣スポット（距離順）と再訪理由カード（優先順）
 * - 全画面: 5地区の地区カード（Lv・色あせ・主・次の目標）と「Lvは下がらない」の注記
 * refresh() で nearby・reasons・town を並列に読み、読込中・失敗・成功の3状態を描き分ける（docs/03 §6）。
 * 生成時に1回 refresh する。位置が変わったら MapScreen が refresh() を呼ぶ。シートの段階は ctx.ui.sheetState に保つ。
 */
import '@/presentation/screens/Map/Sheet/MapSheet.css';
import type { NearbySpotDto, RevisitReasonDto, TownStateDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { BottomSheet } from '@/Common/ui/BottomSheet';
import type { SheetState } from '@/Common/ui/BottomSheet';
import { createButton } from '@/Common/ui/Button';
import { createSpotStatusIcon } from '@/Common/ui/cards/SpotCard';
import { h, setStyle } from '@/Common/ui/dom';
import { userAction } from '@/Common/ui/userAction';
import type { AppContext } from '@/presentation/App/AppContext';
import { createDistrictCardList } from '@/presentation/screens/Map/Sheet/DistrictCardList';
import { createNearbySpotList } from '@/presentation/screens/Map/Sheet/NearbySpotList';
import { createReasonCardFor, createRevisitReasonList } from '@/presentation/screens/Map/Sheet/RevisitReasonList';
import {
  LEVEL_NEVER_DROPS_NOTE,
  NEARBY_LIMIT,
  nearestSpot,
  nearestSpotLines,
  strongestReason,
  UNKNOWN_SPOT_MESSAGE,
} from '@/presentation/screens/Map/Sheet/sheetModel';
import type { SheetTarget } from '@/presentation/screens/Map/Sheet/sheetModel';
import { createSpotThumb } from '@/presentation/shared/spotThumb';

const logger = createLogger('presentation/screens/Map/Sheet/MapSheet');

/** 地図下シートの操作 */
export interface MapSheetHandle {
  /** シート全体（地図画面のルートに追加する） */
  readonly element: HTMLElement;
  /** 近隣スポット・再訪理由・地区カードを読み直して描き直す */
  refresh(): Promise<void>;
  /** 後始末 */
  destroy(): void;
}

/** シートからの遷移要求 */
export interface MapSheetHandlers {
  /** スポットカードが押された */
  onSpot(spotId: string): void;
  /** 地区カード・再訪理由カードが押された */
  onDistrict(districtId: string): void;
}

/** シートに出すデータ（3つのユースケースの結果） */
interface SheetData {
  readonly nearby: readonly NearbySpotDto[];
  readonly reasons: readonly RevisitReasonDto[];
  readonly town: TownStateDto;
}

/** 描画関数に渡す遷移の受け口 */
interface RenderDeps {
  goSpot(spotId: string): void;
  goDistrict(districtId: string): void;
  goTarget(target: SheetTarget): void;
  onUnknown(): void;
}

/** 読込状態（読込中・失敗・成功） */
type LoadState = 'loading' | 'error' | 'ready';

/**
 * つまみの高さ（rem）。「いちばん近いスポット」と再訪理由1件の2行（各44px以上）を収めるため Common の既定 7.5rem より高い。
 * MapScreen は地図の下側の余白（シートで隠れる高さ）にこの値を使う。CSS 変数 --sheet-peek-h にも同じ値を設定する。
 */
export const MAP_SHEET_PEEK_REM = 9.5;

/** 段階の一覧 */
const SLOT_STATES: readonly SheetState[] = ['peek', 'half', 'full'];

/** 段階ごとの入れ物の testid */
const SLOT_TEST_IDS: Readonly<Record<SheetState, string>> = { peek: 'sheet-peek', half: 'sheet-half', full: 'sheet-full' };

/**
 * 地図下シートを作る。生成時に1回 refresh する。
 * @param ctx 画面コンテキスト（services・toast・ui.sheetState を使う）
 * @param handlers 遷移要求の受け口（MapScreen がルーター遷移に変換する）
 * @returns シートの操作
 * @sideEffect services の nearby・reasons・town を呼ぶ
 */
export function createMapSheet(ctx: AppContext, handlers: MapSheetHandlers): MapSheetHandle {
  const log = logger.fn('createMapSheet', { sheetState: ctx.ui.sheetState });
  const controller = new MapSheetController(ctx, handlers);
  void controller.refresh();
  return log.exit({
    element: controller.element,
    refresh: (): Promise<void> => controller.refresh(),
    destroy: (): void => controller.destroy(),
  });
}

/** 下シートの状態と描画を受け持つ */
class MapSheetController {
  /** シート全体 */
  readonly element: HTMLElement;
  private readonly ctx: AppContext;
  private readonly sheet: BottomSheet;
  private readonly slots: Readonly<Record<SheetState, HTMLElement>>;
  private readonly deps: RenderDeps;
  /** 読込の世代（古い読込の結果を捨てる） */
  private token = 0;
  private destroyed = false;
  private hasData = false;

  /**
   * シートと3段階の入れ物を作る。
   * @param ctx 画面コンテキスト
   * @param handlers 遷移要求の受け口
   * @sideEffect ctx.ui.sheetState をシートの段階変更に合わせて書き換える
   */
  constructor(ctx: AppContext, handlers: MapSheetHandlers) {
    const log = logger.fn('constructor', { sheetState: ctx.ui.sheetState });
    this.ctx = ctx;
    this.sheet = new BottomSheet({
      initial: ctx.ui.sheetState,
      label: '近くのスポットと次に訪れる理由',
      onStateChange: (state): void => {
        ctx.ui.sheetState = state;
      },
    });
    this.sheet.element.classList.add('map-sheet');
    setStyle(this.sheet.element, '--sheet-peek-h', `${MAP_SHEET_PEEK_REM}rem`);
    this.element = this.sheet.element;
    this.slots = { peek: createSlot('peek'), half: createSlot('half'), full: createSlot('full') };
    for (const state of SLOT_STATES) this.sheet.setContent(state, this.slots[state]);
    this.deps = this.createDeps(handlers);
    this.renderStatus('loading');
    log.exit(undefined);
  }

  /**
   * 3つのユースケースを読み直して描き直す。古い読込・破棄後の結果は捨てる。
   * 2回目以降の失敗は今の表示を残してトーストで知らせる。
   * @sideEffect services を呼び、シートの中身を差し替える
   */
  async refresh(): Promise<void> {
    const log = logger.fn('refresh', { hasData: this.hasData });
    if (this.destroyed) return log.exit(undefined, '破棄済み');
    const token = ++this.token;
    if (!this.hasData) this.renderStatus('loading');
    const result = await this.load();
    if (this.destroyed || token !== this.token) return log.exit(undefined, '古い読込のため捨てる');
    if (!result.ok) {
      if (this.hasData) this.ctx.toast.show('近くの情報を更新できませんでした', { kind: 'error' });
      else this.renderStatus('error');
      log.fail(undefined, result.error.code);
      return;
    }
    this.hasData = true;
    this.render(result.value);
    log.exit(undefined);
  }

  /**
   * シートを片付ける（以降の refresh は何もしない）。
   * @sideEffect シートのリスナを外し、DOM から取り除く
   */
  destroy(): void {
    const log = logger.fn('destroy');
    this.destroyed = true;
    this.sheet.destroy();
    log.exit(undefined);
  }

  /**
   * nearby・reasons・town を並列に読む。
   * @returns 成功: シートのデータ。失敗: 最初に失敗したユースケースの AppError（想定外の例外は UNEXPECTED）
   * @sideEffect services を呼ぶ
   */
  private async load(): Promise<Result<SheetData>> {
    const log = logger.fn('load', { limit: NEARBY_LIMIT });
    const services = this.ctx.services;
    try {
      const [nearby, reasons, town] = await Promise.all([
        services.nearby.execute({ limit: NEARBY_LIMIT }),
        services.reasons.execute(),
        services.town.execute(),
      ]);
      if (!nearby.ok) return log.fail(nearby);
      if (!reasons.ok) return log.fail(reasons);
      if (!town.ok) return log.fail(town);
      return log.exit(ok({ nearby: nearby.value, reasons: reasons.value, town: town.value }));
    } catch (error) {
      // 画面の境界：想定外の例外で下シートが空のままにならないよう、記録して失敗表示に変える
      log.error('下シートの読込で想定外の例外が起きました', { error });
      return log.fail(fail(AppError.of('UNEXPECTED', '近くの情報を読み込めませんでした', undefined, error)));
    }
  }

  /**
   * 遷移の受け口を作る。地区へ移るときはシートをつまみに戻して地図を見せる。
   * @param handlers MapScreen から受け取った遷移要求の受け口
   * @returns 描画関数に渡す受け口
   */
  private createDeps(handlers: MapSheetHandlers): RenderDeps {
    const log = logger.fn('createDeps');
    const deps: RenderDeps = {
      goSpot: (spotId: string): void => handlers.onSpot(spotId),
      goDistrict: (districtId: string): void => this.goDistrict(handlers, districtId),
      goTarget: (target: SheetTarget): void => (target.kind === 'spot' ? handlers.onSpot(target.id) : this.goDistrict(handlers, target.id)),
      onUnknown: (): void => this.ctx.toast.show(UNKNOWN_SPOT_MESSAGE, { kind: 'info' }),
    };
    return log.exit(deps);
  }

  /**
   * 地区へ移る。シートをつまみに戻してから遷移を要求する（全画面のままだと地図が見えないため）。
   * @param handlers 遷移要求の受け口
   * @param districtId 地区ID
   * @sideEffect シートの段階（ctx.ui.sheetState）を peek にし、handlers.onDistrict を呼ぶ
   */
  private goDistrict(handlers: MapSheetHandlers, districtId: string): void {
    const log = logger.fn('goDistrict', { districtId });
    this.sheet.setState('peek');
    handlers.onDistrict(districtId);
    log.exit(undefined);
  }

  /**
   * 読込中・失敗の表示を3段階すべてに出す。
   * @param state 'loading' または 'error'
   * @sideEffect 各段階の入れ物の中身を差し替える
   */
  private renderStatus(state: Exclude<LoadState, 'ready'>): void {
    const log = logger.fn('renderStatus', { state });
    for (const key of SLOT_STATES) {
      const slot = this.slots[key];
      slot.dataset.load = state;
      slot.replaceChildren(buildStatusMessage(state, (): void => void this.refresh()));
    }
    log.exit(undefined);
  }

  /**
   * 読み込んだデータで3段階の中身を描く。
   * @param data シートのデータ
   * @sideEffect 各段階の入れ物の中身を差し替える
   */
  private render(data: SheetData): void {
    const log = logger.fn('render', { nearby: data.nearby.length, reasons: data.reasons.length, districts: data.town.districts.length });
    this.slots.peek.replaceChildren(buildPeek(data, this.deps));
    this.slots.half.replaceChildren(buildHalf(data, this.deps));
    this.slots.full.replaceChildren(buildFull(data, this.deps));
    for (const state of SLOT_STATES) this.slots[state].dataset.load = 'ready';
    log.exit(undefined);
  }
}

/**
 * 段階ごとの入れ物を作る（data-testid="sheet-peek|sheet-half|sheet-full"、data-load=読込状態）。
 * @param state 段階
 * @returns div 要素
 */
function createSlot(state: SheetState): HTMLElement {
  return h('div', { class: ['map-sheet__slot', `map-sheet__slot--${state}`], attrs: { 'data-testid': SLOT_TEST_IDS[state], 'data-load': 'loading' } });
}

/**
 * 読込中・失敗の表示を作る。失敗時は「もう一度読み込む」ボタン（data-testid="sheet-retry"）を付ける。
 * @param state 'loading' または 'error'
 * @param onRetry 再読込の処理
 * @returns 表示要素
 */
function buildStatusMessage(state: Exclude<LoadState, 'ready'>, onRetry: () => void): HTMLElement {
  const log = logger.fn('buildStatusMessage', { state });
  if (state === 'loading') {
    return log.exit(h('p', { class: ['hint', 'map-sheet__status'], attrs: { 'data-testid': 'sheet-loading' }, text: '読み込み中…' }));
  }
  const retry = createButton({ label: 'もう一度読み込む', variant: 'secondary', testId: 'sheet-retry', onClick: onRetry });
  const message = h('p', { class: 'hint', text: '近くの情報を読み込めませんでした。' });
  return log.exit(h('div', { class: 'map-sheet__status', attrs: { 'data-testid': 'sheet-error' } }, [message, retry]));
}

/**
 * つまみの中身（いちばん近いスポット＋いちばん強い再訪理由1件）を作る。
 * @param data シートのデータ
 * @param deps 遷移の受け口
 * @returns 中身の要素
 */
function buildPeek(data: SheetData, deps: RenderDeps): HTMLElement {
  const log = logger.fn('buildPeek', { nearby: data.nearby.length, reasons: data.reasons.length });
  const reason = strongestReason(data.reasons);
  const reasonView =
    reason === undefined
      ? h('p', { class: ['hint', 'map-sheet__empty'], text: 'いまは急ぎの理由はありません' })
      : createReasonCardFor(reason, { compact: true, onTarget: (target): void => deps.goTarget(target) });
  return log.exit(h('div', { class: 'map-sheet__peek' }, [buildNearestRow(nearestSpot(data.nearby), deps), reasonView]));
}

/**
 * つまみの「いちばん近いスポット」の行を作る（data-testid="sheet-nearest"）。
 * チェックインできる範囲（VISIT_RADIUS_M＝80m）で今日まだ訪問していなければ「チェックイン」（data-testid="sheet-visit"）を出し、押すとスポット詳細へ。
 * @param spot いちばん近いスポット（無ければ undefined）
 * @param deps 遷移の受け口
 * @returns 行の要素
 */
function buildNearestRow(spot: NearbySpotDto | undefined, deps: RenderDeps): HTMLElement {
  const log = logger.fn('buildNearestRow', { spotId: spot?.id, canVisit: spot?.canVisit });
  if (spot === undefined) {
    return log.exit(h('p', { class: ['hint', 'map-sheet__nearest'], attrs: { 'data-testid': 'sheet-nearest' }, text: '近くにスポットはありません' }));
  }
  const lines = nearestSpotLines(spot);
  const spotId = spot.id;
  const open = spot.status === 'unknown' ? (): void => deps.onUnknown() : (): void => deps.goSpot(spotId);
  const main = h('button', { class: 'map-sheet__nearest-main', attrs: { type: 'button' }, on: { click: userAction('sheet-nearest', open) } }, [
    createSpotThumb({ id: spot.id, kind: spot.kind, status: spot.status, name: spot.name }) ?? createSpotStatusIcon(spot.status),
    h('span', { class: 'map-sheet__nearest-text' }, [
      h('span', { class: 'map-sheet__nearest-title', text: lines.title }),
      h('span', { class: 'map-sheet__nearest-sub', text: lines.sub }),
    ]),
  ]);
  const visit = spot.canVisit ? createButton({ label: 'チェックイン', variant: 'primary', testId: 'sheet-visit', onClick: (): void => deps.goSpot(spotId) }) : undefined;
  const attrs = {
    'data-testid': 'sheet-nearest',
    'data-spot-id': spotId,
    'data-status': spot.status,
    'data-can-visit': spot.canVisit ? '1' : '0',
    'data-district-id': spot.status === 'unknown' ? undefined : spot.districtId,
  };
  return log.exit(h('div', { class: 'map-sheet__nearest', attrs }, [main, visit]));
}

/**
 * 半分の中身（近隣スポット・再訪理由）を作る。
 * @param data シートのデータ
 * @param deps 遷移の受け口
 * @returns 中身の要素
 */
function buildHalf(data: SheetData, deps: RenderDeps): HTMLElement {
  const log = logger.fn('buildHalf');
  return log.exit(
    h('div', { class: 'map-sheet__half' }, [
      h('h2', { class: 'sheet-section-title', text: '近くのスポット' }),
      createNearbySpotList(data.nearby, { onSpot: (spotId): void => deps.goSpot(spotId), onUnknown: (): void => deps.onUnknown() }),
      h('h2', { class: 'sheet-section-title', text: 'また行きたくなる理由' }),
      createRevisitReasonList(data.reasons, (target): void => deps.goTarget(target)),
    ]),
  );
}

/**
 * 全画面の中身（地区カード一覧と注記）を作る。
 * @param data シートのデータ
 * @param deps 遷移の受け口
 * @returns 中身の要素
 */
function buildFull(data: SheetData, deps: RenderDeps): HTMLElement {
  const log = logger.fn('buildFull', { districts: data.town.districts.length });
  return log.exit(
    h('div', { class: 'map-sheet__full' }, [
      h('h2', { class: 'sheet-section-title', text: '地区のようす' }),
      createDistrictCardList(data.town.districts, (districtId): void => deps.goDistrict(districtId)),
      h('p', { class: ['hint', 'map-sheet__note'], attrs: { 'data-testid': 'sheet-level-note' }, text: LEVEL_NEVER_DROPS_NOTE }),
    ]),
  );
}
