/**
 * @file 全画面演出の再生役（presentation/screens/Effects 層）
 * 生成時にドメインイベント（復活・おかえりボーナス・カード・主交代・アイテム・加点・成長）を購読し、beginCapture 中だけためる。
 * flush() でためたイベントを 復活（おかえりボーナス込み）→ カード → 主交代（自分が主になったときだけ）→ アイテム の順に
 * 1つずつ全画面で再生し（各 2.5 秒で自動送り・「スキップ」で次へ）、終わったら加点・成長のまとめを返す（docs/08 §6）。
 * 地区名・地区色は services.town から引く。演出層（layer）は App が用意した最前面の層（ステータスバー・タブバーも覆う）。
 */
import '@/presentation/screens/Effects/Effects.css';
import type { AppServices } from '@/application/AppServices';
import { createLogger } from '@/Common/logging/logger';
import type { EventOfType } from '@/domain/events/DomainEvent';
import type { EffectPlayer, EffectSummary } from '@/presentation/App/AppContext';
import { createCardAwardEffect } from '@/presentation/screens/Effects/CardAwardEffect';
import { createDistrictLordChangeEffect } from '@/presentation/screens/Effects/DistrictLordChangeEffect';
import { createEffectFrame, waitForAdvance } from '@/presentation/screens/Effects/EffectFrame';
import type { EffectView } from '@/presentation/screens/Effects/EffectFrame';
import { EFFECT_AUTO_ADVANCE_MS } from '@/presentation/screens/Effects/effectMath';
import { EFFECT_SOURCE_TYPES, planEffects, summarizeEffects } from '@/presentation/screens/Effects/effectPlan';
import type { EffectPlanItem } from '@/presentation/screens/Effects/effectPlan';
import { createItemAcquiredEffect } from '@/presentation/screens/Effects/ItemAcquiredEffect';
import { createRevivalEffect } from '@/presentation/screens/Effects/RevivalEffect';

const logger = createLogger('presentation/screens/Effects/EffectHost');

/** 購読するイベント種別 */
type CapturedType = (typeof EFFECT_SOURCE_TYPES)[number];

/** 購読するイベント（domain の型） */
type CapturedEvent = EventOfType<CapturedType>;

/** 演出に使う地区の表示情報 */
interface DistrictInfo {
  readonly name: string;
  readonly color: string;
}

/** 地区が分からないときの表示 */
const FALLBACK_DISTRICT: DistrictInfo = { name: '地区', color: '#8a8a8a' };

/**
 * 演出の再生役を作る。生成した時点でイベントの購読を始める（アプリ全体で1つだけ作る）。
 * @param layer 演出を描く全画面の層（中身が空なら操作を通す）
 * @param services イベント購読と地区名の取得に使うサービス
 * @returns 演出の再生役
 * @sideEffect services.events に7種のイベントの購読を登録する
 */
export function createEffectHost(layer: HTMLElement, services: AppServices): EffectPlayer {
  const log = logger.fn('createEffectHost', { isDemo: services.isDemo, layer: layer.dataset.testid });
  const host = new EffectHost(layer, services);
  const player: EffectPlayer = {
    beginCapture: (): void => host.beginCapture(),
    flush: (): Promise<EffectSummary> => host.flush(),
  };
  return log.exit(player);
}

/**
 * 地区の表示情報を引く（無ければ既定値）。
 * @param districts 地区ID → 表示情報
 * @param districtId 地区ID
 * @returns 表示情報
 */
function districtOf(districts: ReadonlyMap<string, DistrictInfo>, districtId: string): DistrictInfo {
  return districts.get(districtId) ?? FALLBACK_DISTRICT;
}

/**
 * 演出の内容から表示を作る。
 * @param item 演出1つ分の内容
 * @param districts 地区ID → 表示情報
 * @returns 演出1つ分の表示
 */
function buildEffectView(item: EffectPlanItem, districts: ReadonlyMap<string, DistrictInfo>): EffectView {
  const log = logger.fn('buildEffectView', { kind: item.kind });
  switch (item.kind) {
    case 'revival': {
      const district = districtOf(districts, item.districtId);
      return log.exit(
        createRevivalEffect({
          districtId: item.districtId,
          districtName: district.name,
          color: district.color,
          daysSinceLastVisit: item.daysSinceLastVisit,
          level: item.level,
          multiplier: item.multiplier,
        }),
      );
    }
    case 'card':
      return log.exit(createCardAwardEffect({ districtName: districtOf(districts, item.districtId).name, rank: item.rank, reason: item.reason, visitCount: item.visitCount }));
    case 'lord':
      return log.exit(
        createDistrictLordChangeEffect({ districtName: districtOf(districts, item.districtId).name, fromName: item.fromName, reclaimed: item.reclaimed, travelerCount: item.travelerCount }),
      );
    case 'item':
      return log.exit(createItemAcquiredEffect({ name: item.name, itemId: item.itemId }));
  }
}

/** イベントのため込みと演出の再生を受け持つ */
class EffectHost {
  private readonly layer: HTMLElement;
  private readonly services: AppServices;
  private capturing = false;
  private buffer: CapturedEvent[] = [];
  /** ため込み中に受け取った eventId（重複配送を無視する＝DI-19） */
  private readonly seen = new Set<string>();
  /** 再生中の演出（flush が重なったら前の再生が終わるのを待つ） */
  private playing: Promise<void> | undefined;

  /**
   * 再生役を作り、イベントの購読を始める。
   * @param layer 演出を描く全画面の層
   * @param services サービス一覧
   * @sideEffect services.events に購読を登録する
   */
  constructor(layer: HTMLElement, services: AppServices) {
    const log = logger.fn('constructor', { types: EFFECT_SOURCE_TYPES.length });
    this.layer = layer;
    this.services = services;
    for (const type of EFFECT_SOURCE_TYPES) services.events.subscribe(type, this.capture);
    log.exit(undefined);
  }

  /**
   * イベントのため込みを始める（前回の残りは捨てる）。
   * @sideEffect バッファを空にし、ため込み中にする
   */
  beginCapture(): void {
    const log = logger.fn('beginCapture', { leftover: this.buffer.length });
    this.buffer = [];
    this.seen.clear();
    this.capturing = true;
    log.exit(undefined);
  }

  /**
   * ため込みを終え、たまったイベントを演出として順に再生し、まとめを返す。演出が無ければすぐ返す。
   * @returns 加点・おかえりボーナス・成長した地区のまとめ
   * @sideEffect 演出層に全画面の演出を出し入れする。services.town を呼ぶ
   */
  async flush(): Promise<EffectSummary> {
    const log = logger.fn('flush', { count: this.buffer.length, capturing: this.capturing });
    const events = this.buffer;
    this.buffer = [];
    this.seen.clear();
    this.capturing = false;
    const summary = summarizeEffects(events);
    const plan = planEffects(events);
    if (plan.length > 0) await this.playExclusive(plan);
    return log.exit(summary);
  }

  /**
   * ため込み中ならイベントをバッファに入れる（同じ eventId は1回だけ）。
   * @param event 購読しているイベント
   * @sideEffect バッファに追加する
   */
  private readonly capture = (event: CapturedEvent): void => {
    const log = logger.fn('capture', { type: event.type, capturing: this.capturing });
    if (!this.capturing || this.seen.has(event.eventId)) return log.exit(undefined, '対象外');
    this.seen.add(event.eventId);
    this.buffer.push(event);
    log.exit(undefined);
  };

  /**
   * 他の再生が終わるのを待ってから再生する（演出が重ならないようにする）。
   * @param plan 演出の列
   * @sideEffect 演出層に全画面の演出を出し入れする
   */
  private async playExclusive(plan: readonly EffectPlanItem[]): Promise<void> {
    const log = logger.fn('playExclusive', { count: plan.length, waiting: this.playing !== undefined });
    while (this.playing !== undefined) await this.playing;
    const run = this.play(plan);
    this.playing = run;
    try {
      await run;
    } finally {
      if (this.playing === run) this.playing = undefined;
    }
    log.exit(undefined);
  }

  /**
   * 演出を順に1つずつ再生する。1つが失敗しても残りは続ける。
   * @param plan 演出の列
   * @sideEffect services.town を呼び、演出層に要素を出し入れする
   */
  private async play(plan: readonly EffectPlanItem[]): Promise<void> {
    const log = logger.fn('play', { kinds: plan.map((item) => item.kind) });
    const districts = await this.loadDistricts();
    for (const item of plan) {
      try {
        await this.playOne(buildEffectView(item, districts));
      } catch (error) {
        // 演出の境界：1つの演出の失敗で訪問の後処理（トースト・遷移）を止めないよう、記録して次へ進む
        log.error('演出の再生に失敗しました', { kind: item.kind, error });
      }
    }
    log.exit(undefined);
  }

  /**
   * 演出を1つ全画面で再生し、スキップか自動送りで閉じる。
   * @param view 演出1つ分の表示
   * @sideEffect 演出層に枠を追加し、終わったら取り除く。アニメーションを開始・停止する
   */
  private async playOne(view: EffectView): Promise<void> {
    const log = logger.fn('playOne', { kind: view.kind });
    const frame = createEffectFrame(view, EFFECT_AUTO_ADVANCE_MS);
    this.layer.append(frame.element);
    try {
      frame.skipButton.focus({ preventScroll: true });
      view.start();
      const reason = await waitForAdvance(frame, EFFECT_AUTO_ADVANCE_MS);
      log.info('演出を閉じました', { kind: view.kind, reason });
    } finally {
      view.stop();
      frame.element.remove();
    }
    log.exit(undefined);
  }

  /**
   * 地区名と地区色を services.town から読む。失敗したら既定の名前で演出する。
   * @returns 地区ID → 表示情報
   * @sideEffect services.town を呼ぶ
   */
  private async loadDistricts(): Promise<ReadonlyMap<string, DistrictInfo>> {
    const log = logger.fn('loadDistricts');
    const town = await this.services.town.execute();
    if (!town.ok) {
      log.warn('地区名を読めないため既定の名前で演出します', { code: town.error.code });
      return log.exit(new Map<string, DistrictInfo>());
    }
    return log.exit(new Map(town.value.districts.map((d): [string, DistrictInfo] => [d.id, { name: d.name, color: d.color }])));
  }
}
