/**
 * @file 発見・訪問・購入・チケットをサーバーで実行するユースケース（infrastructure/api 層。docs/12 §6 段階2 のアプリ側）
 * 画面からは今までと同じ UseCase（AppServices の discover・visit・purchase・useTicket）に見える。中身は
 * 「現在地を取る → サーバーの API へ送る → 記録の写しを読み直す → サーバーが返したドメインイベントを画面へ流す」。
 * 距離・1日1回・EXP の計算はサーバーが行い、アプリは結果を受け取るだけ（SEC-21）。位置はログに出さない（PRV-03）。
 * 位置が取れなければ失敗を返す（デモ位置に切り替えない＝SEC-27）。応答は外部データなので形を検証する（DI-01）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { isRecord } from '@/Common/utils/guards';
import type { UseCase } from '@/application/AppServices';
import type { DiscoverInput, DiscoverOutput, PurchaseInput, PurchaseOutput, UseTicketInput, UseTicketOutput, VisitInput, VisitOutput } from '@/application/dto/Dto';
import type { EventBus } from '@/application/events/EventBus';
import { isDomainEventType } from '@/domain/events/DomainEvent';
import type { DomainEvent } from '@/domain/events/DomainEvent';
import type { GeoProvider } from '@/domain/ports/GeoProvider';
import { requestApi } from '@/infrastructure/api/requestApi';
import type { ApiClientDeps } from '@/infrastructure/api/requestApi';
import { APP_API } from '@/infrastructure/api/ServerPlayState';
import type { ServerPlayState } from '@/infrastructure/api/ServerPlayState';

const logger = createLogger('infrastructure/api/HttpPlayUseCase');

/** 応答の値（未検証のオブジェクト） */
type Raw = Readonly<Record<string, unknown>>;

/** サーバーで実行するユースケースの依存 */
export interface HttpPlayDeps {
  readonly api: ApiClientDeps;
  readonly geo: GeoProvider;
  /** サーバーの記録の写し（書き込みの後に読み直す） */
  readonly state: ServerPlayState;
  /** 画面の演出へ流すイベントバス */
  readonly events: Pick<EventBus, 'publish'>;
}

/** 1つの API の定義 */
interface PlayEndpoint<O> {
  readonly path: string;
  /** 応答の value を出力 DTO として検証する */
  readonly parse: (raw: Raw) => O | undefined;
}

/**
 * 項目がすべてその型か確かめる。
 * @param raw 未検証のオブジェクト
 * @param types 項目名 → typeof の値
 * @returns すべて合っていれば true
 */
function hasFields(raw: Raw, types: Readonly<Record<string, 'string' | 'number' | 'boolean'>>): boolean {
  return Object.entries(types).every(([key, type]) => typeof raw[key] === type);
}

/**
 * 応答に入っているドメインイベントを取り出す（種類を知っているものだけ）。
 * @param raw 応答の value
 * @returns イベント
 */
function eventsOf(raw: Raw): readonly DomainEvent[] {
  const log = logger.fn('eventsOf');
  const list: unknown = raw['events'];
  if (!Array.isArray(list)) return log.exit([]);
  const items: readonly unknown[] = list;
  const known = items.filter((item) => isRecord(item) && isDomainEventType(item['type']) && typeof item['eventId'] === 'string');
  // 境界での型付け：自分のサーバーが EventFactory で作ったイベント。種類と eventId を確認済み
  return log.exit(known as readonly DomainEvent[], `count=${known.length}`);
}

/** 発見の出力の検証 */
const DISCOVER: PlayEndpoint<DiscoverOutput> = {
  path: APP_API.discoveries,
  /** newlyDiscovered が { id, name, kind, districtId } の配列か確かめる */
  parse: (raw) => {
    const list: unknown = raw['newlyDiscovered'];
    if (!Array.isArray(list)) return undefined;
    const items: readonly unknown[] = list;
    const valid = items.every((s) => isRecord(s) && hasFields(s, { id: 'string', name: 'string', districtId: 'string' }) && (s['kind'] === 'landmark' || s['kind'] === 'shop'));
    return valid ? { newlyDiscovered: items as DiscoverOutput['newlyDiscovered'] } : undefined; // 各項目の型を確認済み
  },
};

/** 訪問の出力の検証 */
const VISIT: PlayEndpoint<VisitOutput> = {
  path: APP_API.visits,
  /** 項目の型を確かめる */
  parse: (raw) => (hasFields(raw, { spotId: 'string', districtId: 'string', localDate: 'string', duplicate: 'boolean' })
    ? { spotId: raw['spotId'] as string, districtId: raw['districtId'] as string, localDate: raw['localDate'] as string, duplicate: raw['duplicate'] as boolean }
    : undefined),
};

/** 購入の出力の検証 */
const PURCHASE: PlayEndpoint<PurchaseOutput> = {
  path: APP_API.purchases,
  /** 項目の型を確かめる */
  parse: (raw) => (hasFields(raw, { spotId: 'string', districtId: 'string', localDate: 'string', points: 'number', limited: 'boolean', duplicate: 'boolean', purchasesAtSpot: 'number', totalPoints: 'number' })
    ? {
      spotId: raw['spotId'] as string, districtId: raw['districtId'] as string, localDate: raw['localDate'] as string, points: raw['points'] as number,
      limited: raw['limited'] as boolean, duplicate: raw['duplicate'] as boolean, purchasesAtSpot: raw['purchasesAtSpot'] as number, totalPoints: raw['totalPoints'] as number,
    }
    : undefined),
};

/** チケットを使う出力の検証 */
const USE_TICKET: PlayEndpoint<UseTicketOutput> = {
  path: APP_API.useTicket,
  /** 項目の型を確かめる */
  parse: (raw) => (hasFields(raw, { ticketId: 'string', usedOn: 'string', duplicate: 'boolean' })
    ? { ticketId: raw['ticketId'] as string, usedOn: raw['usedOn'] as string, duplicate: raw['duplicate'] as boolean }
    : undefined),
};

/** サーバーで実行するユースケース（発見・訪問・購入・チケットで共通） */
export class HttpPlayUseCase<I extends object, O> implements UseCase<I, O> {
  /**
   * 作る。
   * @param deps 呼び出し・位置・記録の写し・イベントバス
   * @param endpoint 道筋と出力の検証
   */
  constructor(private readonly deps: HttpPlayDeps, private readonly endpoint: PlayEndpoint<O>) {}

  /**
   * 現在地を添えてサーバーへ送り、結果を返す。
   * @param input 画面からの入力（operationId など。サーバーが検証する）
   * @returns 成功: 出力 DTO。失敗: GEO_UNAVAILABLE／GEO_DENIED／サーバーの失敗（OUT_OF_RANGE・ALREADY_VISITED_TODAY・TOO_FAST・UNAUTHENTICATED など）／NETWORK_FAILED／INVALID_RESPONSE
   * @sideEffect GeoProvider.current、ネットワーク、記録の写しの読み直し、イベントの発行
   */
  async execute(input: I): Promise<Result<O>> {
    const log = logger.fn('execute', { path: this.endpoint.path });
    const fix = await this.deps.geo.current();
    if (!fix.ok) return log.fail(fix);
    const position = { lat: fix.value.point.lat, lng: fix.value.point.lng, accuracyM: fix.value.accuracyM };
    const response = await requestApi(this.deps.api, { method: 'POST', path: this.endpoint.path, body: { ...input, position } });
    if (!response.ok) return log.fail(response);
    const raw = isRecord(response.value) ? response.value : {};
    const output = this.endpoint.parse(raw);
    if (output === undefined) return log.fail(fail(AppError.of('INVALID_RESPONSE', 'サーバーの応答が正しくありません')));
    const refreshed = await this.deps.state.refresh();
    if (!refreshed.ok) log.warn('記録の読み直しに失敗（次の操作で読み直す）', { code: refreshed.error.code });
    await this.deps.events.publish(eventsOf(raw));
    return log.exit(ok(output));
  }
}

/** サーバーで実行するユースケース一式 */
export interface HttpPlayUseCases {
  readonly discover: UseCase<DiscoverInput, DiscoverOutput>;
  readonly visit: UseCase<VisitInput, VisitOutput>;
  readonly purchase: UseCase<PurchaseInput, PurchaseOutput>;
  readonly useTicket: UseCase<UseTicketInput, UseTicketOutput>;
}

/**
 * サーバーで実行するユースケース一式を作る。
 * @param deps 呼び出し・位置・記録の写し・イベントバス
 * @returns 発見・訪問・購入・チケット
 */
export function buildHttpPlayUseCases(deps: HttpPlayDeps): HttpPlayUseCases {
  const log = logger.fn('buildHttpPlayUseCases');
  return log.exit({
    discover: new HttpPlayUseCase(deps, DISCOVER), visit: new HttpPlayUseCase(deps, VISIT),
    purchase: new HttpPlayUseCase(deps, PURCHASE), useTicket: new HttpPlayUseCase(deps, USE_TICKET),
  });
}
