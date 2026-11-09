/**
 * @file 端末 GPS の位置（infrastructure/geo 層。GeoProvider の本番実装）
 * navigator.geolocation.getCurrentPosition を1回呼ぶ（高精度・タイムアウト 10 秒・キャッシュ不可）。
 * 権限拒否は GEO_DENIED、それ以外（タイムアウト・測位不能・API なし）は GEO_UNAVAILABLE。
 * 失敗してもデモ位置などへ黙って切り替えない（SEC-27）。座標はログに出さず、保存もしない（SEC-13, PRV-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { GeoPoint } from '@/domain/exploration/GeoPoint';
import type { Clock } from '@/domain/ports/Clock';
import type { GeoErrorCode, GeoFix, GeoProvider } from '@/domain/ports/GeoProvider';

const logger = createLogger('infrastructure/geo/BrowserGeoProvider');

/** 測位のタイムアウト（ミリ秒） */
export const GEO_TIMEOUT_MS = 10_000;

/** GeolocationPositionError.PERMISSION_DENIED の値 */
const PERMISSION_DENIED_CODE = 1;

/** GeolocationPositionError.TIMEOUT の値 */
const TIMEOUT_CODE = 3;

/** 位置取得の結果 */
type GeoResult = Result<GeoFix, AppError<GeoErrorCode>>;

/** BrowserGeoProvider の依存 */
export interface BrowserGeoProviderDeps {
  /** 測位時刻に使う時計（DI-03） */
  readonly clock: Clock;
  /** Geolocation を返す関数（省略時は navigator.geolocation。テストで偽物を渡す） */
  readonly geolocation?: () => Geolocation | undefined;
  /** タイムアウト（ミリ秒。省略時は GEO_TIMEOUT_MS） */
  readonly timeoutMs?: number;
}

/**
 * ブラウザの Geolocation を返す（API が無い環境では undefined）。
 * @returns navigator.geolocation または undefined
 */
function defaultGeolocation(): Geolocation | undefined {
  const log = logger.fn('defaultGeolocation');
  if (typeof navigator === 'undefined') return log.exit(undefined);
  const geolocation: Geolocation | undefined = navigator.geolocation;
  return log.exit(geolocation);
}

/**
 * 位置が取れない失敗を作る。
 * @param reason 理由（ログ用: noApi / timeout / positionUnavailable / invalidCoords / thrown）
 * @param cause 元の例外・エラー（任意）
 * @returns GEO_UNAVAILABLE の失敗
 */
function unavailable(reason: string, cause?: unknown): GeoResult {
  return fail(AppError.of('GEO_UNAVAILABLE', '現在地を取得できませんでした', { reason }, cause));
}

/** 端末 GPS の位置 */
export class BrowserGeoProvider implements GeoProvider {
  /**
   * 位置を作る。
   * @param deps 時計・Geolocation・タイムアウト
   */
  constructor(private readonly deps: BrowserGeoProviderDeps) {}

  /**
   * 現在地を1回取得する。
   * @returns 成功: 位置・精度（m）・時計の現在時刻。失敗: GEO_DENIED（権限拒否）/ GEO_UNAVAILABLE（その他）
   * @sideEffect ブラウザの位置情報 API を呼ぶ（初回は権限ダイアログが出る）
   * @see docs/05 SEC-27
   */
  async current(): Promise<GeoResult> {
    const log = logger.fn('current');
    let geolocation: Geolocation | undefined;
    try {
      geolocation = (this.deps.geolocation ?? defaultGeolocation)();
    } catch (error) {
      return log.fail(unavailable('thrown', error));
    }
    if (geolocation === undefined) return log.fail(unavailable('noApi'));
    const result = await this.request(geolocation);
    return result.ok ? log.exit(result, `accuracyM=${result.value.accuracyM}`) : log.fail(result);
  }

  /**
   * getCurrentPosition を Promise にする（同期例外も失敗として返す）。
   * @param geolocation 使う Geolocation
   * @returns 位置取得の結果
   */
  private request(geolocation: Geolocation): Promise<GeoResult> {
    const log = logger.fn('request');
    const options: PositionOptions = { enableHighAccuracy: true, timeout: this.deps.timeoutMs ?? GEO_TIMEOUT_MS, maximumAge: 0 };
    return log.exit(
      new Promise<GeoResult>((resolve) => {
        try {
          geolocation.getCurrentPosition(
            (position) => resolve(this.toFix(position)),
            (error) => resolve(this.toError(error)),
            options,
          );
        } catch (error) {
          resolve(unavailable('thrown', error));
        }
      }),
    );
  }

  /**
   * 測位結果を検証して GeoFix にする（座標・精度が不正なら GEO_UNAVAILABLE）。
   * @param position ブラウザの測位結果
   * @returns 成功: GeoFix。失敗: GEO_UNAVAILABLE
   */
  private toFix(position: GeolocationPosition): GeoResult {
    const log = logger.fn('toFix');
    const point = GeoPoint.of(position.coords.latitude, position.coords.longitude);
    const accuracyM = position.coords.accuracy;
    if (!point.ok || !Number.isFinite(accuracyM) || accuracyM < 0) return log.fail(unavailable('invalidCoords'));
    return log.exit(ok({ point: point.value, accuracyM, at: this.deps.clock.now() }));
  }

  /**
   * 測位エラーを失敗コードにする（権限拒否だけ GEO_DENIED）。
   * @param error ブラウザの測位エラー
   * @returns GEO_DENIED / GEO_UNAVAILABLE の失敗
   */
  private toError(error: GeolocationPositionError): GeoResult {
    const log = logger.fn('toError', { errorCode: error.code });
    if (error.code === PERMISSION_DENIED_CODE) {
      log.warn('位置情報の利用が許可されていません');
      return log.fail(fail(AppError.of('GEO_DENIED', '位置情報の利用が許可されていません。端末の設定をご確認ください')));
    }
    log.warn('位置情報を取得できませんでした', { errorCode: error.code });
    return log.fail(unavailable(error.code === TIMEOUT_CODE ? 'timeout' : 'positionUnavailable'));
  }
}
