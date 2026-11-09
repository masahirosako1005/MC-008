/**
 * @file 現在地を返すユースケース（application 層・読取系）
 * 地図の現在地マーカーと 80m／40m 円の描画専用。座標は保存せず、ログにも出さない（SEC-13, PRV-03, LG-03）。
 * 位置が取れないときは GeoProvider の失敗（GEO_UNAVAILABLE／GEO_DENIED）をそのまま返し、デモ位置などに切り替えない（SEC-27）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { PositionDto } from '@/application/dto/Dto';
import type { GeoProvider } from '@/domain/ports/GeoProvider';

const logger = createLogger('application/usecases/exploration/GetCurrentPositionUseCase');

/** GetCurrentPositionUseCase の依存 */
export interface GetCurrentPositionDeps {
  readonly geo: GeoProvider;
}

/** 現在地を返す */
export class GetCurrentPositionUseCase implements UseCase<void, PositionDto> {
  /**
   * 依存を受け取る。
   * @param deps 位置の供給元（本番は BrowserGeoProvider、デモは DemoGeoProvider）
   */
  constructor(private readonly deps: GetCurrentPositionDeps) {}

  /**
   * 現在地を1回取得して返す。
   * @returns 成功: { lat, lng, accuracyM }（凍結済み・描画専用）。失敗: GEO_UNAVAILABLE / GEO_DENIED（そのまま返す＝SEC-27）
   * @sideEffect GeoProvider.current を呼ぶ（本番では端末の測位が走る）
   */
  async execute(): Promise<Result<PositionDto>> {
    const log = logger.fn('execute');
    const fix = await this.deps.geo.current();
    if (!fix.ok) return log.fail(fix, '位置を取得できない');
    const dto: PositionDto = Object.freeze({ lat: fix.value.point.lat, lng: fix.value.point.lng, accuracyM: fix.value.accuracyM });
    return log.exit(ok(dto), `精度 ${fix.value.accuracyM}m`);
  }
}
