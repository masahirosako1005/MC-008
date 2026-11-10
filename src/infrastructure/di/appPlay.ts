/**
 * @file 利用者の発見・訪問をサーバーで実行するための組み立て（infrastructure/di 層。docs/12 §2・§6 段階2）
 * 利用者アプリと同じユースケース（DiscoverNearbySpots・VisitSpot と、訪問後の地区の変化・加点）を、1回の要求ごとに
 * 「ログイン中の旅人」「端末が申告した位置」「サーバーの時計」「PostgreSQL のリポジトリ」で組み立てる（サーバーが正＝SEC-21）。
 * - 旅人は要求の値ではなくセッションから決める（SEC-01）
 * - 位置は距離の判定に使うだけで、保存もログもしない（PRV-03）
 * - 発行されたドメインイベントは集めて応答に入れる（端末が演出に使う）
 * 地区の主（領主）の再判定は、実際の利用者どうしで計算する段階3で足す（ここでは登録しない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { TravelerId } from '@/Common/types/Id';
import type { UseCase } from '@/application/AppServices';
import type { DiscoverInput, DiscoverOutput, PurchaseInput, PurchaseOutput, UseTicketInput, UseTicketOutput, VisitInput, VisitOutput } from '@/application/dto/Dto';
import { EventFactory } from '@/application/events/EventFactory';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { DiscoverNearbySpotsUseCase } from '@/application/usecases/exploration/DiscoverNearbySpotsUseCase';
import { VisitSpotUseCase } from '@/application/usecases/exploration/VisitSpotUseCase';
import { AwardVisitRewardsUseCase } from '@/application/usecases/reward/AwardVisitRewardsUseCase';
import { RecordPurchaseUseCase } from '@/application/usecases/reward/RecordPurchaseUseCase';
import { UseTicketUseCase } from '@/application/usecases/reward/UseTicketUseCase';
import { EvaluateDistrictChangeUseCase } from '@/application/usecases/town/EvaluateDistrictChangeUseCase';
import type { DomainEvent } from '@/domain/events/DomainEvent';
import { DEFAULT_NICKNAME } from '@/domain/exploration/constants';
import type { GeoPoint } from '@/domain/exploration/GeoPoint';
import { Traveler } from '@/domain/exploration/Traveler';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoProvider } from '@/domain/ports/GeoProvider';
import type { PointLedgerRepository } from '@/domain/reward/PointLedgerRepository';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import { InMemoryEventBus } from '@/infrastructure/events/InMemoryEventBus';
import { CryptoIdGenerator } from '@/infrastructure/random/CryptoIdGenerator';

const logger = createLogger('infrastructure/di/appPlay');

/** 端末が申告した位置 */
export interface ClaimedPosition {
  readonly point: GeoPoint;
  /** 測位精度（メートル） */
  readonly accuracyM: number;
}

/** 1回の要求で使うユースケース */
export interface AppPlayServices {
  readonly discover: UseCase<DiscoverInput, DiscoverOutput>;
  readonly visit: UseCase<VisitInput, VisitOutput>;
  /** お店での購入（EXP。お店の近くにいること・同じ日の上限はユースケースが確かめる） */
  readonly purchase: UseCase<PurchaseInput, PurchaseOutput>;
  /** チケット（クーポン）を使う */
  readonly useTicket: UseCase<UseTicketInput, UseTicketOutput>;
  /** この要求で発行されたドメインイベント（発行順） */
  events(): readonly DomainEvent[];
  /** 訪問後の処理（地区の変化・加点）で失敗した数。1つでもあれば、その訪問ごと取り消す（DI-12） */
  handlerFailures(): number;
}

/** 組み立ての依存（サーバーで1つ） */
export interface AppPlayDeps {
  readonly travelers: TravelerRepository;
  readonly ledgers: PointLedgerRepository;
  readonly spots: SpotRepository;
  readonly clock: Clock;
}

/**
 * ログイン中の旅人だけを返すセッション（要求ごと。保存はしない）。
 * @param travelerId ログイン中の旅人ID
 * @returns SessionRepository
 */
function fixedSession(travelerId: TravelerId): SessionRepository { // audit-ignore: fnlog-missing 固定の値を返す小さなポートを作るだけ
  return {
    /** ログイン中の旅人を返す */
    load: async () => ok({ activeTravelerId: travelerId }),
    /** 何もしない（サーバーではセッションを切り替えない） */
    save: async () => ok(undefined),
  };
}

/**
 * 端末が申告した位置を返す位置ポート（測位の時刻はサーバーの時計）。
 * @param position 申告された位置
 * @param clock サーバーの時計
 * @returns GeoProvider
 */
function claimedGeo(position: ClaimedPosition, clock: Clock): GeoProvider { // audit-ignore: fnlog-missing 固定の値を返す小さなポートを作るだけ（位置をログに出さない）
  return {
    /** 申告された位置を返す */
    current: async () => ok({ point: position.point, accuracyM: position.accuracyM, at: clock.now() }),
  };
}

/**
 * 旅人がまだ保存されていなければ作る（初めてのログインの後、最初の要求で1回）。
 * @param travelers 旅人リポジトリ
 * @param travelerId ログイン中の旅人ID
 * @returns 成功: 旅人。失敗: STORAGE_FAILED
 * @sideEffect 無ければ DB に旅人を作る
 */
export async function ensureServerTraveler(travelers: TravelerRepository, travelerId: TravelerId): Promise<Result<Traveler>> {
  const log = logger.fn('ensureServerTraveler', { travelerId });
  const found = await travelers.findById(travelerId);
  if (!found.ok) return log.fail(found);
  if (found.value !== undefined) return log.exit(ok(found.value), 'existing');
  const created = await travelers.save(Traveler.create(travelerId, DEFAULT_NICKNAME, 'user'), 0);
  if (created.ok) return log.exit(ok(created.value), 'created');
  if (created.error.code !== 'CONFLICT') return log.fail(created);
  // 同時に届いた別の要求が先に作った。読み直す
  const again = await travelers.findById(travelerId);
  if (!again.ok) return log.fail(again);
  return again.value === undefined ? log.fail(created) : log.exit(ok(again.value), 'raced');
}

/**
 * 1回の要求で使うユースケースを組み立てる。
 * @param deps リポジトリ・マスタ・時計
 * @param travelerId ログイン中の旅人ID（セッションから決めたもの）
 * @param position 端末が申告した位置
 * @returns 発見・訪問・購入・チケットのユースケースと、発行されたイベントの読み出し
 */
export function buildAppPlayServices(deps: AppPlayDeps, travelerId: TravelerId, position: ClaimedPosition): AppPlayServices {
  const log = logger.fn('buildAppPlayServices', { travelerId, accuracyM: position.accuracyM }); // 位置はログに出さない（PRV-03）
  const bus = new InMemoryEventBus();
  const recorded: DomainEvent[] = [];
  let failures = 0;
  const events = {
    /** 発行されたイベントを集めてから、購読ハンドラへ流す */
    publish: async (published: readonly DomainEvent[]): Promise<void> => {
      recorded.push(...published);
      await bus.publish(published);
    },
  };
  const base = {
    ...deps, events, session: fixedSession(travelerId), geo: claimedGeo(position, deps.clock),
    eventFactory: new EventFactory({ ids: new CryptoIdGenerator(), clock: deps.clock }),
  };
  const evaluate = new EvaluateDistrictChangeUseCase(base);
  const award = new AwardVisitRewardsUseCase(base);
  for (const handler of [{ name: 'EvaluateDistrictChange', run: evaluate.handle.bind(evaluate) }, { name: 'AwardVisitRewards', run: award.handle.bind(award) }]) {
    bus.subscribe('SpotVisited', async (event) => {
      const result = await handler.run(event);
      if (result.ok) return;
      failures += 1;
      logger.fn('visitHandler').error('訪問後の処理に失敗', { handler: handler.name, code: result.error.code });
    });
  }
  return log.exit({
    discover: new DiscoverNearbySpotsUseCase(base), visit: new VisitSpotUseCase(base),
    purchase: new RecordPurchaseUseCase(base), useTicket: new UseTicketUseCase(base),
    events: () => recorded, handlerFailures: () => failures,
  });
}
