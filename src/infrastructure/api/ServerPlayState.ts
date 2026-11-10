/**
 * @file サーバーが持つ利用者の記録の写し（infrastructure/api 層。docs/12 §3・§6 段階2 のアプリ側）
 * 商用版では旅人の記録（発見・訪問・クーポン利用）と EXP の台帳はサーバーが正（SEC-21）。アプリは起動時と書き込みの後に
 * /api/app/state を読み、その写しを画面の読み取り系ユースケースへ渡す（ServerPlayRepositories）。写しは画面を描くためだけのもので、
 * アプリ側で書き換えてもサーバーには届かない。
 * 応答は外部データなので、Traveler.restore・PointLedger.restore で検証してから使う（DI-01）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok, okVoid } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseTravelerId } from '@/Common/types/Id';
import type { TravelerId } from '@/Common/types/Id';
import { isRecord } from '@/Common/utils/guards';
import { Traveler } from '@/domain/exploration/Traveler';
import { PointLedger } from '@/domain/reward/PointLedger';
import { requestApi } from '@/infrastructure/api/requestApi';
import type { ApiClientDeps } from '@/infrastructure/api/requestApi';

const logger = createLogger('infrastructure/api/ServerPlayState');

/** 利用者 API の道筋（サーバーの appAuthRoutes・appPlayRoutes と対応） */
export const APP_API = Object.freeze({
  providers: '/api/app/auth/providers',
  me: '/api/app/me',
  state: '/api/app/state',
  discoveries: '/api/app/discoveries',
  visits: '/api/app/visits',
  purchases: '/api/app/purchases',
  useTicket: '/api/app/tickets/use',
  /**
   * ログインを始める道筋。
   * @param providerId 提供元の ID
   * @returns 道筋
   */
  loginStart: (providerId: string): string => `/api/app/auth/${providerId}/start`,
});

/** サーバーが持つ利用者の記録の写し */
export class ServerPlayState {
  private currentTraveler: Traveler | undefined;
  private currentLedger: PointLedger | undefined;

  /**
   * 作る（外からは connect を使う）。
   * @param api 呼び出しの依存
   * @param id ログイン中の旅人ID
   */
  private constructor(private readonly api: ApiClientDeps, private readonly id: TravelerId) {}

  /**
   * ログイン中か確かめ、記録を読み込む。
   * @param api 呼び出しの依存
   * @returns 成功: 写し。失敗: UNAUTHENTICATED（ログインしていない）/ NETWORK_FAILED / INVALID_RESPONSE
   * @sideEffect ネットワーク
   */
  static async connect(api: ApiClientDeps): Promise<Result<ServerPlayState>> {
    const log = logger.fn('connect');
    const me = await requestApi(api, { method: 'GET', path: APP_API.me });
    if (!me.ok) return log.fail(me);
    const travelerId = parseTravelerId(isRecord(me.value) ? me.value['travelerId'] : undefined);
    if (!travelerId.ok) return log.fail(fail(AppError.of('INVALID_RESPONSE', 'サーバーの応答が正しくありません')));
    const state = new ServerPlayState(api, travelerId.value);
    const loaded = await state.refresh();
    return loaded.ok ? log.exit(ok(state)) : log.fail(loaded);
  }

  /** ログイン中の旅人ID */
  get travelerId(): TravelerId {
    return this.id;
  }

  /**
   * 旅人の写しを返す。
   * @returns 旅人（connect が済んでいれば必ずある）
   */
  traveler(): Traveler | undefined {
    return this.currentTraveler;
  }

  /**
   * 台帳の写しを返す。
   * @returns 台帳（connect が済んでいれば必ずある）
   */
  ledger(): PointLedger | undefined {
    return this.currentLedger;
  }

  /**
   * サーバーから記録を読み直す（起動時と、書き込みの後）。失敗したら前の写しのまま。
   * @returns 成功: void。失敗: UNAUTHENTICATED / NETWORK_FAILED / INVALID_RESPONSE（ほかの人の記録・形が違う）
   * @sideEffect ネットワーク。写しを置き換える
   */
  async refresh(): Promise<Result<void>> {
    const log = logger.fn('refresh');
    const response = await requestApi(this.api, { method: 'GET', path: APP_API.state });
    if (!response.ok) return log.fail(response);
    const value = isRecord(response.value) ? response.value : {};
    const traveler = Traveler.restore(value['traveler']);
    const ledger = PointLedger.restore(value['ledger']);
    if (!traveler.ok || !ledger.ok || traveler.value.id !== this.id || ledger.value.travelerId !== this.id) {
      return log.fail(fail(AppError.of('INVALID_RESPONSE', 'サーバーの応答が正しくありません')));
    }
    this.currentTraveler = traveler.value;
    this.currentLedger = ledger.value;
    return log.exit(okVoid(), `visits=${traveler.value.visits.length}`);
  }
}
