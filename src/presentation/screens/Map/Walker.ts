/**
 * @file デモの歩行と発見判定の呼び出し（presentation/screens/Map 層）
 * 地図タップで現在地から目的地まで 10m 刻みで歩かせる（デモ専用。本番は GPS なので歩かせない）。
 * 速さは「画面上で人が歩いて見える速さ」（WALK_SCREEN_SPEED_PX）に合わせる（2026-11-09 ユーザー指示「高速で動くのが変。人が歩いているように」）。
 * 描画用の位置は livePosition で時間に合わせてなめらかに補間し、記録（services.demo.moveTo）は 10m 刻み、発見判定は 20m ごとと到着時（毎回 newOperationId）。
 * 足あとは ctx.ui.footprints（メモリのみ・最大 400 点＝docs/08 D15）。位置座標はログに出さない（距離・歩数だけ）。
 */
import type { DiscoveredSpotDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import type { AppContext } from '@/presentation/App/AppContext';
import { distanceMeters } from '@/presentation/screens/Map/MapViewModel';
import type { LatLng } from '@/presentation/screens/Map/MapViewModel';
import { newOperationId } from '@/presentation/shared/operation';

const logger = createLogger('presentation/screens/Map/Walker');

/** 歩行の刻み（メートル） */
export const WALK_STEP_M = 10;
/** 発見判定を呼ぶ間隔（メートル）。到着時にも必ず呼ぶ */
export const DISCOVER_INTERVAL_M = 20;
/** 歩く速さ（画面上の CSS px/秒）。どのズームでも同じ速さで歩いて見えるようにする（仮） */
export const WALK_SCREEN_SPEED_PX = 55;
/** 歩行速度の下限（m/秒）。デモなので実際の徒歩より速い（仮） */
export const MIN_WALK_SPEED_MPS = 20;
/** 歩行速度の上限（m/秒）。広い表示でも速すぎないようにする（仮） */
export const MAX_WALK_SPEED_MPS = 90;
/** 歩行にかける最長時間（秒）。遠いときはこれ以内に着くよう速める（仮） */
export const MAX_WALK_SECONDS = 6;
/** 縮尺が分からないときの縮尺（m/px。詳細表示＝幅 450m を幅 390px で見たときの値） */
export const DEFAULT_WALK_METERS_PER_PX = 450 / 390;
/** 足あとの最大点数（古いものから捨てる） */
export const MAX_FOOTPRINTS = 400;
/** 足あとの最後の点から現在地がこれ以上離れていたら（位置リセット等で飛んだ）足あとを引き直す（メートル） */
export const FOOTPRINT_JUMP_M = WALK_STEP_M * 3;

/** 歩行の通知先（MapScreen） */
export interface WalkerHooks {
  /** 1刻み進んだ（位置を描画に反映する） */
  onStep(position: LatLng): void;
  /** 新しくスポットを発見した（トーストは表示済み。リング演出・データ再取得に使う） */
  onDiscovered(spots: readonly DiscoveredSpotDto[]): void;
  /** 歩行が終わった（arrived=false は途中で止まった） */
  onStop(arrived: boolean): void;
}

/** デモの歩行 */
export interface Walker {
  /** from から to へ歩く（metersPerPx は表示中の縮尺。歩く速さを画面上でそろえる）。歩行中なら今の位置から新しい目的地へ向かい直す */
  walkTo(from: LatLng, to: LatLng, metersPerPx?: number): void;
  /** 折れ線（道に沿った経路。先頭は出発点）に沿って歩く。歩行中なら今の位置から歩き直す */
  walkPath(points: readonly LatLng[], metersPerPx?: number): void;
  /** これから歩く残りの道筋（今の位置から目的地まで）。歩いていなければ空 */
  remainingRoute(now: number): readonly LatLng[];
  /** 描画用の今の位置（時間に合わせてなめらかに補間）。歩いていなければ undefined */
  livePosition(now: number): LatLng | undefined;
  /** 東西の進む向き（東=1・西=-1・真南北=0）。歩いていなければ undefined */
  heading(): number | undefined;
  /** 歩行中か */
  isWalking(): boolean;
  /** 歩行を止めて後始末する（以後の通知はしない） */
  destroy(): void;
}

/** 1回の歩行の経路 */
interface WalkRoute {
  readonly from: LatLng;
  readonly to: LatLng;
  /** 道筋の折れ線（先頭が出発点） */
  readonly points: readonly LatLng[];
  /** 折れ線の各点までの累積距離（メートル） */
  readonly cum: readonly number[];
  /** 全体の距離（メートル） */
  readonly totalM: number;
  readonly path: readonly LatLng[];
  /** 1刻みの長さ（メートル。WALK_STEP_M 以下） */
  readonly stepLengthM: number;
  readonly speedMps: number;
  /** performance.now() の時刻 */
  readonly startedAt: number;
  /** 進んだ刻みの数 */
  done: number;
}

/**
 * 歩行速度を返す。画面上で WALK_SCREEN_SPEED_PX になる速さを MIN〜MAX に収め、遠いときは MAX_WALK_SECONDS 以内に着くよう速める。
 * @param distanceM 歩く距離（メートル）
 * @param metersPerPx 表示中の縮尺（m/px）
 * @returns 速度（m/秒）
 */
export function walkSpeedMps(distanceM: number, metersPerPx = DEFAULT_WALK_METERS_PER_PX): number {
  const log = logger.fn('walkSpeedMps', { meters: Math.round(distanceM), metersPerPx });
  const pace = Math.min(MAX_WALK_SPEED_MPS, Math.max(MIN_WALK_SPEED_MPS, WALK_SCREEN_SPEED_PX * metersPerPx));
  return log.exit(Math.max(pace, distanceM / MAX_WALK_SECONDS));
}

/**
 * 歩き始めてから elapsedMs 経過した時点の位置を返す（from→to の直線上。到着後は to）。
 * @param route 出発点・目的地・距離・速度
 * @param elapsedMs 経過時間（ミリ秒）
 * @returns 位置
 */
export function pointAlong(route: { readonly from: LatLng; readonly to: LatLng; readonly totalM: number; readonly speedMps: number }, elapsedMs: number): LatLng { // audit-ignore: fnlog-missing 毎フレーム呼ぶ純粋な算術ヘルパー（座標を扱うのでログに出さない）
  const k = route.totalM > 0 ? Math.min(1, Math.max(0, ((elapsedMs / 1000) * route.speedMps) / route.totalM)) : 1;
  return { lat: route.from.lat + (route.to.lat - route.from.lat) * k, lng: route.from.lng + (route.to.lng - route.from.lng) * k };
}

/**
 * from から to までを stepM 以下の等間隔で区切った経路を返す（from は含めず、最後は to そのもの）。
 * @param from 出発点
 * @param to 目的地
 * @param stepM 刻み（メートル、正の数）
 * @returns 経路（1点以上。from と to が同じなら [to]）
 */
export function interpolateWalk(from: LatLng, to: LatLng, stepM = WALK_STEP_M): LatLng[] {
  const meters = distanceMeters(from, to);
  const log = logger.fn('interpolateWalk', { meters: Math.round(meters), stepM });
  const steps = Math.max(1, Math.ceil(meters / Math.max(0.001, stepM)));
  const path: LatLng[] = [];
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    path.push({ lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k });
  }
  path.push({ lat: to.lat, lng: to.lng });
  log.exit({ steps: path.length });
  return path;
}

/**
 * 折れ線の各点までの累積距離（メートル）を返す。
 * @param points 折れ線
 * @returns 累積距離（先頭は 0）
 */
export function cumulativeMeters(points: readonly LatLng[]): number[] {
  const log = logger.fn('cumulativeMeters', { points: points.length });
  const cum: number[] = [];
  let total = 0;
  points.forEach((p, k) => {
    const prev = points[k - 1];
    if (prev !== undefined) total += distanceMeters(prev, p);
    cum.push(total);
  });
  return log.exit(cum, `${Math.round(total)}m`);
}

/**
 * 折れ線の上で、出発点から distance メートル進んだ点を返す（範囲外は端）。
 * @param points 折れ線
 * @param cum 累積距離
 * @param distance 進んだ距離（メートル）
 * @returns 位置
 */
export function pointOnPolyline(points: readonly LatLng[], cum: readonly number[], distance: number): LatLng { // audit-ignore: fnlog-missing 毎フレーム呼ぶ純粋な算術ヘルパー（座標を扱うのでログに出さない）
  const last = points[points.length - 1] ?? { lat: 0, lng: 0 };
  if (distance >= (cum[cum.length - 1] ?? 0)) return last;
  for (let k = 1; k < points.length; k++) {
    const d1 = cum[k] ?? 0;
    if (d1 < distance) continue;
    const d0 = cum[k - 1] ?? 0;
    const a = points[k - 1] ?? last;
    const b = points[k] ?? last;
    const t = d1 > d0 ? Math.max(0, (distance - d0) / (d1 - d0)) : 1;
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  }
  return last;
}

/**
 * 折れ線を、記録の刻み（WALK_STEP_M 以下）の点列にする（出発点は含めず、目的地は必ず含める）。
 * @param points 折れ線
 * @param cum 累積距離
 * @param stepM 刻み（メートル）
 * @returns 刻みの点列
 */
export function resamplePolyline(points: readonly LatLng[], cum: readonly number[], stepM = WALK_STEP_M): LatLng[] {
  const total = cum[cum.length - 1] ?? 0;
  const log = logger.fn('resamplePolyline', { meters: Math.round(total), stepM });
  const steps = Math.max(1, Math.ceil(total / Math.max(0.001, stepM)));
  const path: LatLng[] = [];
  for (let i = 1; i <= steps; i++) path.push(pointOnPolyline(points, cum, (total * i) / steps));
  return log.exit(path, `${path.length} 刻み`);
}

/**
 * 歩き始めてから elapsedMs 経過した時点で進んでいるべき刻みの数を返す。
 * @param elapsedMs 経過時間（ミリ秒）
 * @param speedMps 速度（m/秒）
 * @param stepLengthM 1刻みの長さ（メートル。0 以下なら即到着）
 * @param totalSteps 全刻み数
 * @returns 0〜totalSteps
 */
export function stepsDue(elapsedMs: number, speedMps: number, stepLengthM: number, totalSteps: number): number { // audit-ignore: fnlog-missing 毎フレーム呼ぶ純粋な算術ヘルパー
  if (!(stepLengthM > 0)) return totalSteps;
  const due = Math.floor(((Math.max(0, elapsedMs) / 1000) * speedMps) / stepLengthM);
  return Math.min(totalSteps, Math.max(0, due));
}

/**
 * この刻みの後に発見判定を呼ぶか（20m の区切りをまたいだとき、または到着したとき）。
 * @param stepIndex 進んだ刻みの番号（0 始まり）
 * @param totalSteps 全刻み数
 * @param stepLengthM 1刻みの長さ（メートル）
 * @returns 呼ぶなら true
 */
export function shouldDiscoverAfter(stepIndex: number, totalSteps: number, stepLengthM: number): boolean {
  const log = logger.fn('shouldDiscoverAfter', { stepIndex, totalSteps });
  if (stepIndex >= totalSteps - 1) return log.exit(true);
  const before = Math.floor((stepIndex * stepLengthM) / DISCOVER_INTERVAL_M + 1e-9);
  const after = Math.floor(((stepIndex + 1) * stepLengthM) / DISCOVER_INTERVAL_M + 1e-9);
  return log.exit(after > before);
}

/**
 * 足あとに1点を足す（max を超えたら古い点から捨てる）。
 * @param footprints 足あと（ctx.ui.footprints。その場で書き換える）
 * @param point 足す点
 * @param max 最大点数
 * @sideEffect footprints を書き換える
 */
export function appendFootprint(footprints: { lat: number; lng: number }[], point: LatLng, max = MAX_FOOTPRINTS): void {
  const log = logger.fn('appendFootprint', { length: footprints.length, max });
  footprints.push({ lat: point.lat, lng: point.lng });
  if (footprints.length > max) footprints.splice(0, footprints.length - max);
  log.exit(undefined);
}

/**
 * 発見判定を呼び、新しく見つかったスポットごとに「発見！」トーストを出す。
 * @param ctx 画面コンテキスト
 * @returns 新しく発見したスポット（失敗時は空配列）
 * @sideEffect services.discover を呼ぶ（発見記録の保存）。トーストを表示する
 */
export async function discoverNearby(ctx: AppContext): Promise<readonly DiscoveredSpotDto[]> {
  const log = logger.fn('discoverNearby');
  const result = await ctx.services.discover.execute({ operationId: newOperationId() });
  if (!result.ok) return log.fail([], result.error.code);
  for (const spot of result.value.newlyDiscovered) ctx.toast.show(`発見！ ${spot.name}（図鑑にシルエット登録）`, { kind: 'discover' });
  return log.exit(result.value.newlyDiscovered);
}

/**
 * デモの歩行を作る（services.demo が無い本番ビルドでは使わない）。
 * @param ctx 画面コンテキスト
 * @param hooks 歩行の通知先
 * @returns 歩行
 */
export function createWalker(ctx: AppContext, hooks: WalkerHooks): Walker {
  const log = logger.fn('createWalker', { isDemo: ctx.services.isDemo });
  return log.exit(new DemoWalker(ctx, hooks));
}

/** デモの歩行の実装（requestAnimationFrame で時間に合わせて刻みを進める） */
class DemoWalker implements Walker {
  private route: WalkRoute | undefined;
  /** 最後に進んだ位置 */
  private current: LatLng | undefined;
  private running = false;
  private destroyed = false;
  private rafId: number | undefined;
  /** 待機中のフレーム待ちを解く関数（destroy で解く） */
  private wake: (() => void) | undefined;

  /**
   * 歩行を作る。
   * @param ctx 画面コンテキスト
   * @param hooks 歩行の通知先
   */
  constructor(
    private readonly ctx: AppContext,
    private readonly hooks: WalkerHooks,
  ) {}

  /**
   * from から to へ歩く。歩行中なら今の位置（描画中の位置）から新しい目的地へ向かい直す。
   * @param from 出発点（歩行中は無視して今の位置から）
   * @param to 目的地
   * @param metersPerPx 表示中の縮尺（m/px。歩く速さを画面上でそろえる）
   * @sideEffect ctx.ui.footprints を書き換え、歩行ループを開始する
   */
  walkTo(from: LatLng, to: LatLng, metersPerPx?: number): void {
    const log = logger.fn('walkTo', { walking: this.route !== undefined });
    this.walkPath([from, to], metersPerPx);
    log.exit(undefined);
  }

  /**
   * 折れ線（道に沿った経路）に沿って歩く。歩行中なら今の位置（描画中の位置）を出発点に置き換えて歩き直す。
   * @param points 道筋（先頭が出発点、末尾が目的地）
   * @param metersPerPx 表示中の縮尺（m/px。歩く速さを画面上でそろえる）
   * @sideEffect ctx.ui.footprints を書き換え、歩行ループを開始する
   */
  walkPath(points: readonly LatLng[], metersPerPx?: number): void {
    const log = logger.fn('walkPath', { walking: this.route !== undefined, points: points.length });
    const first = points[0];
    const to = points[points.length - 1];
    if (this.destroyed || first === undefined || to === undefined) return log.exit(undefined, '破棄済みまたは経路なし');
    const start = this.livePosition(performance.now()) ?? (this.route !== undefined && this.current !== undefined ? this.current : first);
    const line = [start, ...points.slice(1)];
    const cum = cumulativeMeters(line);
    const meters = cum[cum.length - 1] ?? 0;
    const path = resamplePolyline(line, cum);
    this.startTrail(start);
    this.current = start;
    this.route = { from: start, to, points: line, cum, totalM: meters, path, stepLengthM: meters / Math.max(1, path.length), speedMps: walkSpeedMps(meters, metersPerPx), startedAt: performance.now(), done: 0 };
    log.info('歩き始めました', { meters: Math.round(meters), steps: path.length, turns: line.length });
    if (!this.running) {
      this.running = true;
      void this.run();
    }
    log.exit(undefined);
  }

  /**
   * 歩行中か返す。
   * @returns 歩行中なら true
   */
  isWalking(): boolean {
    return this.route !== undefined;
  }

  /**
   * 描画用の今の位置を返す（時間に合わせて補間。記録の刻みより先に進んで見える）。
   * @param now 現在時刻（performance.now()）
   * @returns 位置（歩いていなければ undefined）
   */
  livePosition(now: number): LatLng | undefined { // audit-ignore: fnlog-missing 毎フレーム描画（座標を扱うのでログに出さない）
    const route = this.route;
    if (route === undefined) return undefined;
    return pointOnPolyline(route.points, route.cum, ((now - route.startedAt) / 1000) * route.speedMps);
  }

  /**
   * これから歩く残りの道筋を返す（今の位置 → 残りの曲がり角 → 目的地）。
   * @param now 現在時刻（performance.now()）
   * @returns 折れ線（歩いていなければ空）
   */
  remainingRoute(now: number): readonly LatLng[] { // audit-ignore: fnlog-missing 毎フレーム描画（座標を扱うのでログに出さない）
    const route = this.route;
    if (route === undefined) return [];
    const walked = ((now - route.startedAt) / 1000) * route.speedMps;
    const here = pointOnPolyline(route.points, route.cum, walked);
    return [here, ...route.points.filter((_, k) => (route.cum[k] ?? 0) > walked)];
  }

  /**
   * 東西の進む向きを返す（アバターの向きに使う。いま歩いている区間の向き）。
   * @returns 東=1・西=-1・真南北=0。歩いていなければ undefined
   */
  heading(): number | undefined { // audit-ignore: fnlog-missing 毎フレーム描画
    const route = this.route;
    if (route === undefined) return undefined;
    const walked = ((performance.now() - route.startedAt) / 1000) * route.speedMps;
    const idx = route.cum.findIndex((d) => d > walked);
    const k = idx < 0 ? route.points.length - 1 : Math.max(1, idx);
    const a = route.points[k - 1] ?? route.from;
    const b = route.points[k] ?? route.to;
    return Math.sign(b.lng - a.lng);
  }

  /**
   * 歩行を止めて後始末する。
   * @sideEffect requestAnimationFrame を取り消し、歩行ループを終わらせる
   */
  destroy(): void {
    const log = logger.fn('destroy', { walking: this.route !== undefined });
    this.destroyed = true;
    this.route = undefined;
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
    this.wake?.();
    this.wake = undefined;
    log.exit(undefined);
  }

  /**
   * 足あとの始点を用意する（空なら出発点を置く。位置リセット等で飛んでいたら引き直す）。
   * @param start 出発点
   * @sideEffect ctx.ui.footprints を書き換える
   */
  private startTrail(start: LatLng): void {
    const log = logger.fn('startTrail', { length: this.ctx.ui.footprints.length });
    const footprints = this.ctx.ui.footprints;
    const last = footprints[footprints.length - 1];
    if (last !== undefined && distanceMeters(last, start) > FOOTPRINT_JUMP_M) footprints.splice(0, footprints.length);
    if (footprints.length === 0) appendFootprint(footprints, start);
    log.exit(undefined);
  }

  /**
   * 歩行ループ。フレームごとに経過時間に見合う刻みまで進め、到着したら止まる。
   * @sideEffect services.demo.moveTo・services.discover を呼び、通知先を呼ぶ
   */
  private async run(): Promise<void> {
    const log = logger.fn('run');
    while (!this.destroyed && this.route !== undefined) {
      await this.nextFrame();
      const route = this.route;
      if (this.destroyed || route === undefined) break;
      const due = stepsDue(performance.now() - route.startedAt, route.speedMps, route.stepLengthM, route.path.length);
      while (!this.destroyed && this.route === route && route.done < due) {
        if (!(await this.advance(route))) {
          this.finish(false);
          break;
        }
      }
      if (!this.destroyed && this.route === route && route.done >= route.path.length) this.finish(true);
    }
    this.running = false;
    log.exit(undefined);
  }

  /**
   * 1刻み進める（足あと・描画・デモ位置の更新、必要なら発見判定）。
   * @param route 歩行中の経路
   * @returns 続けてよければ true（位置を更新できなければ false）
   * @sideEffect services.demo.moveTo・services.discover を呼ぶ。ctx.ui.footprints を書き換える
   */
  private async advance(route: WalkRoute): Promise<boolean> {
    const index = route.done;
    const log = logger.fn('advance', { index, total: route.path.length });
    const point = route.path[index];
    const moveTo = this.ctx.services.demo?.moveTo;
    if (point === undefined || moveTo === undefined) return log.fail(false, '経路またはデモ機能がありません');
    route.done = index + 1;
    this.current = point;
    appendFootprint(this.ctx.ui.footprints, point);
    this.hooks.onStep(point);
    const moved = await moveTo.execute({ lat: point.lat, lng: point.lng });
    if (!moved.ok) {
      if (!this.destroyed) this.ctx.toast.show('そこへは移動できません', { kind: 'error' });
      return log.fail(false, moved.error.code);
    }
    if (shouldDiscoverAfter(index, route.path.length, route.stepLengthM)) await this.discover();
    return log.exit(true);
  }

  /**
   * 発見判定を呼び、見つかったら通知する。
   * @sideEffect services.discover を呼ぶ。トーストを表示し、通知先を呼ぶ
   */
  private async discover(): Promise<void> {
    const log = logger.fn('discover');
    const found = await discoverNearby(this.ctx);
    if (found.length > 0 && !this.destroyed) this.hooks.onDiscovered(found);
    log.exit(undefined);
  }

  /**
   * 歩行を終える。
   * @param arrived 目的地に着いたら true
   * @sideEffect 通知先の onStop を呼ぶ
   */
  private finish(arrived: boolean): void {
    const log = logger.fn('finish', { arrived });
    this.route = undefined;
    if (!this.destroyed) this.hooks.onStop(arrived);
    log.exit(undefined);
  }

  /**
   * 次の描画フレームまで待つ（destroy されたら即座に解く）。
   * @returns 次のフレームで解決する Promise
   */
  private nextFrame(): Promise<void> { // audit-ignore: fnlog-missing 毎フレーム呼ぶフレーム待ち
    return new Promise((resolve) => {
      this.wake = resolve;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = undefined;
        this.wake = undefined;
        resolve();
      });
    });
  }
}
