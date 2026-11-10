/**
 * @file スポット詳細画面（presentation/screens/Spot 層。ルート '#/spot/:spotId'）
 * スポット情報（写真＝名所は実写・店舗はイメージ写真、無ければ街なみ絵・説明・便利情報・営業時間）、現在地からの距離、訪問ボタン（80m 以内で有効）、
 * クーポン・イベント、自分の訪問履歴を出す（CLAUDE.md 6.4、wireframes/04_spot）。基準 A・C。
 * お店には「アンケート」ボタンを出す（回答は匿名で店舗CMS に届く。services.submitSurvey があるときだけ＝docs/09 CMS-V01）。
 * 訪問フロー: 演出のため込み開始 → visit → 演出を再生（復活・カード・主交代）→ トースト → 地区ズームの地図へ。
 */
import '@/presentation/screens/Spot/SpotDetailScreen.css';
import type { SpotDetailDto } from '@/application/dto/Dto';
import type { SurveyAnswers } from '@/application/usecases/survey/shopSurvey';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createTopBar } from '@/Common/ui/TopBar';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen } from '@/presentation/App/Screen';
import { createCouponEventList } from '@/presentation/screens/Spot/CouponEventList';
import { createMyVisitHistory } from '@/presentation/screens/Spot/MyVisitHistory';
import type { SpotIllustrationHandle } from '@/presentation/screens/Spot/SpotIllustrationCanvas';
import { createSpotVisual } from '@/presentation/screens/Spot/SpotPhotoView';
import { createSpotInfo } from '@/presentation/screens/Spot/SpotInfo';
import { createSurveyButton } from '@/presentation/screens/Spot/SurveyForm';
import { growthToastMessage, visitToastMessage } from '@/presentation/screens/Spot/spotDetailModel';
import { createVisitButton } from '@/presentation/screens/Spot/VisitButton';
import { newOperationId } from '@/presentation/shared/operation';

const logger = createLogger('presentation/screens/Spot/SpotDetailScreen');

/** 上部バーにスポット名を出し始めるスクロール量（CSS px。ヒーローの絵の高さの目安） */
const HEADER_TITLE_SCROLL_PX = 180;

/**
 * スポット詳細画面を作る。
 * @param ctx 画面コンテキスト
 * @param params ルートのパラメータ（spotId はルーターで検証済み）
 * @returns 画面
 */
export function createSpotDetailScreen(ctx: AppContext, params: Readonly<Record<string, string>>): Screen {
  const log = logger.fn('createSpotDetailScreen', { spotId: params.spotId });
  const controller = new SpotDetailController(ctx, params.spotId ?? '');
  const screen: Screen = {
    mount: (root: HTMLElement): Promise<void> => controller.mount(root),
    unmount: (): void => controller.unmount(),
  };
  return log.exit(screen);
}

/** スポット詳細の読込・描画・訪問を受け持つ */
class SpotDetailController {
  private readonly ctx: AppContext;
  private readonly spotId: string;
  private readonly body: HTMLElement;
  private readonly footer: HTMLElement;
  private illustration: SpotIllustrationHandle | undefined;
  /** 上部バー（読み込み後に題名をスポット名へ差し替える） */
  private top: HTMLElement | undefined;
  /** 画面を離れた（以降の非同期結果は捨てる） */
  private disposed = false;
  /** 訪問の実行中（二重タップ防止） */
  private visiting = false;

  /**
   * 画面の骨組み（本文・フッター）を作る。
   * @param ctx 画面コンテキスト
   * @param spotId 表示するスポットID
   */
  constructor(ctx: AppContext, spotId: string) {
    const log = logger.fn('constructor', { spotId });
    this.ctx = ctx;
    this.spotId = spotId;
    this.body = h('div', { class: ['screen-scroll', 'spot-detail__body'], attrs: { 'data-testid': 'spot-detail', 'data-spot-id': spotId, 'data-load': 'loading' } });
    this.footer = h('div', { class: 'spot-detail__footer' });
    log.exit(undefined);
  }

  /**
   * 上部バー・本文・フッターを置き、スポット詳細を読み込んで描く。
   * @param root 画面のルート要素
   * @sideEffect root に DOM を追加し、services.spotDetail を呼ぶ
   */
  async mount(root: HTMLElement): Promise<void> {
    const log = logger.fn('mount', { spotId: this.spotId });
    const top = createTopBar({ title: 'スポット詳細', back: { label: '地図', onClick: (): void => this.ctx.router.back(), testId: 'spot-back' } });
    this.top = top;
    root.append(top, this.body, this.footer);
    this.body.addEventListener('scroll', () => this.syncHeaderTitle(), { passive: true });
    await this.load();
    log.exit(undefined);
  }

  /**
   * 上部バーのスポット名を、絵（ヒーロー）を過ぎてスクロールしたときだけ見せる（カードの見出しと二重に出さない）。
   * @sideEffect 上部バーの data-scrolled を切り替える
   */
  private syncHeaderTitle(): void { // audit-ignore: fnlog-missing スクロールごとに呼ぶ見た目だけの切り替え
    const scrolled = this.body.scrollTop > HEADER_TITLE_SCROLL_PX;
    if (this.top !== undefined && (this.top.dataset.scrolled === '1') !== scrolled) this.top.dataset.scrolled = scrolled ? '1' : '0';
  }

  /**
   * 後始末する（Canvas の監視を止め、以降の非同期結果を捨てる）。
   * @sideEffect ResizeObserver を解除する
   */
  unmount(): void {
    const log = logger.fn('unmount', { spotId: this.spotId });
    this.disposed = true;
    this.illustration?.destroy();
    this.illustration = undefined;
    log.exit(undefined);
  }

  /**
   * スポット詳細を読み込んで描く。失敗（未発見・不正ID など）はトーストで知らせて地図へ戻す。
   * @sideEffect services.spotDetail を呼び、本文を描き直す。失敗時はルーター遷移する
   */
  private async load(): Promise<void> {
    const log = logger.fn('load', { spotId: this.spotId });
    const result = await this.ctx.services.spotDetail.execute({ spotId: this.spotId });
    if (this.disposed) return log.exit(undefined, '画面を離れたため捨てる');
    if (!result.ok) {
      this.body.dataset.load = 'error';
      // 未発見は名詞1語で知らせる（文にしない）。ほかの失敗は application の文言
      this.ctx.toast.show(result.error.code === 'NOT_DISCOVERED' ? '未発見' : result.error.message, { kind: 'error' });
      this.ctx.router.navigate('#/map', { replace: true });
      return log.fail(undefined, result.error.code);
    }
    this.render(result.value);
    log.exit(undefined);
  }

  /**
   * スポット詳細を描く（絵 → 情報 → クーポン・イベント → 訪問履歴、フッターに訪問ボタン）。
   * @param dto スポット詳細
   * @sideEffect 本文・フッターの中身を差し替える
   */
  private render(dto: SpotDetailDto): void {
    const log = logger.fn('render', { spotId: dto.id, status: dto.status, canVisit: dto.canVisit });
    this.illustration?.destroy();
    this.top?.querySelector('.top-bar__title')?.replaceChildren(dto.name);
    this.body.replaceChildren();
    this.body.dataset.districtId = dto.districtId;
    // 写真があれば写真（2026-11-09「リアル写真風に」）、無いか読めなければ街なみイラスト
    this.illustration = createSpotVisual(this.body, { seed: dto.id, kind: dto.kind, category: dto.category, status: dto.status, name: dto.name, districtId: dto.districtId });
    const events = createCouponEventList(dto.shopEvents);
    const survey = dto.kind === 'shop' && this.ctx.services.submitSurvey !== undefined ? [createSurveyButton(dto.status === 'visited', (answers) => this.submitSurvey(dto.id, answers))] : [];
    this.body.append(createSpotInfo(dto), ...(events === undefined ? [] : [events]), createMyVisitHistory(dto), ...survey);
    this.body.dataset.load = 'ready';
    this.body.dataset.status = dto.status;
    this.footer.replaceChildren(createVisitButton(dto, (): Promise<void> => this.visit(dto)));
    log.exit(undefined);
  }

  /**
   * アンケートの答えを送る（匿名。EXP は付かない）。
   * @param spotId お店のスポットID
   * @param answers 答え
   * @returns 送れたら true
   * @sideEffect services.submitSurvey を呼び（書込み・operationId 付き＝DI-07）、トーストを出す
   */
  private async submitSurvey(spotId: string, answers: SurveyAnswers): Promise<boolean> {
    const log = logger.fn('submitSurvey', { spotId });
    const submit = this.ctx.services.submitSurvey;
    if (submit === undefined) return log.exit(false, 'unavailable');
    const result = await submit.execute({ ...answers, operationId: newOperationId(), spotId });
    if (!result.ok) {
      this.ctx.toast.show('送信に失敗', { kind: 'error' });
      return log.fail(false, result.error.code);
    }
    this.ctx.toast.show('回答ありがとう！', { kind: 'success' });
    return log.exit(true);
  }

  /**
   * 訪問ボタンの処理。実行中の再タップは無視する（相関ID は createButton が発行済み）。
   * @param dto 表示中のスポット詳細
   * @sideEffect 訪問を記録し、演出・トースト・地図への遷移を行う
   */
  private async visit(dto: SpotDetailDto): Promise<void> {
    const log = logger.fn('visit', { spotId: dto.id, districtId: dto.districtId });
    if (this.visiting) return log.exit(undefined, '実行中のため無視');
    this.visiting = true;
    try {
      await this.runVisit(dto);
    } catch (error) {
      // 画面の境界：想定外の例外でボタンが押せないままにならないよう、記録して案内する
      log.error('訪問の処理で想定外の例外が起きました', { error });
      this.ctx.toast.show('クエスト達成に失敗', { kind: 'error' });
    } finally {
      this.visiting = false;
    }
    log.exit(undefined);
  }

  /**
   * 訪問フロー本体: ため込み開始 → visit → 演出再生 → トースト → 成長の知らせ → 地区ズームの地図へ。
   * 失敗時はため込みを終えてエラーをトーストし、詳細を読み直す（ボタンの状態を最新にする）。
   * @param dto 表示中のスポット詳細
   * @sideEffect services.visit を呼ぶ（書込み・operationId 付き＝DI-07）。ctx.ui を書き換えてルーター遷移する
   */
  private async runVisit(dto: SpotDetailDto): Promise<void> {
    const log = logger.fn('runVisit', { spotId: dto.id });
    const effects = this.ctx.effects;
    effects.beginCapture();
    const result = await this.ctx.services.visit.execute({ operationId: newOperationId(), spotId: dto.id });
    if (!result.ok) {
      await effects.flush();
      this.ctx.toast.show(result.error.message, { kind: 'error' });
      if (!this.disposed) await this.load();
      return log.fail(undefined, result.error.code);
    }
    const summary = await effects.flush();
    if (result.value.duplicate) this.ctx.toast.show('達成済み', { kind: 'info' });
    else this.ctx.toast.show(visitToastMessage(summary), { kind: 'success' });
    await this.announceGrowth(summary.grownDistrictIds);
    this.moveToDistrictMap(result.value.districtId);
    log.exit(undefined);
  }

  /**
   * 成長した地区を地図のパルスに設定し、「{地区} Lv{n}」をトーストする。
   * @param districtIds 成長した地区ID
   * @sideEffect ctx.ui.pulseDistrictId を設定し、services.town を呼んでトーストを出す
   */
  private async announceGrowth(districtIds: readonly string[]): Promise<void> {
    const log = logger.fn('announceGrowth', { districtIds });
    const first = districtIds[0];
    if (first === undefined) return log.exit(undefined);
    this.ctx.ui.pulseDistrictId = first;
    const town = await this.ctx.services.town.execute();
    const districts = town.ok ? town.value.districts : [];
    for (const districtId of districtIds) {
      const district = districts.find((d) => d.id === districtId);
      this.ctx.toast.show(growthToastMessage(district?.name, district?.level), { kind: 'success' });
    }
    log.exit(undefined);
  }

  /**
   * 訪問した地区にズームした地図へ移る（下シートはつまみに戻して地区の変化を見せる）。
   * 履歴はスポット詳細を置き換える（戻るで詳細に戻らない）。
   * @param districtId 訪問した地区ID
   * @sideEffect ctx.ui を書き換え、ルーター遷移する
   */
  private moveToDistrictMap(districtId: string): void {
    const log = logger.fn('moveToDistrictMap', { districtId, disposed: this.disposed });
    this.ctx.ui.zoom = 'district';
    this.ctx.ui.districtId = districtId;
    this.ctx.ui.sheetState = 'peek';
    if (!this.disposed) this.ctx.router.navigate(`#/map/${districtId}`, { replace: true });
    log.exit(undefined);
  }
}
