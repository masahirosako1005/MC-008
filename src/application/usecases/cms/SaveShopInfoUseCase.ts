/**
 * @file 店舗CMS の営業時間・便利情報を保存するユースケース（application/usecases/cms 層・書込系）
 * docs/09 CMS-S02・S04・S09: 営業時間（全曜日共通の時間＋定休日）と便利情報6種は、運営者の確認なしで「すぐ公開」する。
 * 入力は信用しない（spotId・操作ID・時刻・便利情報を検証＝DI-01）。同じ操作ID の再送は何もしない（DI-07）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { CmsShopInfoDto, SaveShopInfoInput } from '@/application/dto/CmsDto';
import type { CmsSpotEdit } from '@/application/ports/CmsOverlayRepository';
import { findShop, loadOverlayAndToday, parseCmsOperationId, toShopInfoDto, writeOverlay } from '@/application/usecases/cms/cmsShopView';
import type { CmsDeps } from '@/application/usecases/cms/cmsShopView';
import { AMENITIES, isAmenity } from '@/domain/spot/Amenity';
import type { Amenity } from '@/domain/spot/Amenity';
import { createBusinessHours, formatBusinessHours } from '@/domain/spot/BusinessHours';

const logger = createLogger('application/usecases/cms/SaveShopInfoUseCase');

/**
 * 便利情報の入力を検証する（既知の6種だけ・重複なし）。並びは AMENITIES の順にそろえる。
 * @param raw 入力（文字列の配列）
 * @returns 成功: 便利情報。失敗: INVALID_INPUT（field: amenities）
 */
export function parseAmenityInput(raw: readonly unknown[]): Result<readonly Amenity[]> {
  const log = logger.fn('parseAmenityInput', { count: raw.length });
  if (new Set(raw).size !== raw.length || !raw.every(isAmenity)) {
    return log.fail(fail(AppError.of('INVALID_INPUT', '便利情報が正しくありません', { field: 'amenities' })));
  }
  return log.exit(ok(Object.freeze(AMENITIES.filter((a) => raw.includes(a)))));
}

/** 営業時間・便利情報を保存する */
export class SaveShopInfoUseCase implements UseCase<SaveShopInfoInput, CmsShopInfoDto> {
  /**
   * 依存を受け取る。
   * @param deps マスタ・登録内容・時計
   */
  constructor(private readonly deps: Pick<CmsDeps, 'spots' | 'cmsOverlay' | 'clock'>) {}

  /**
   * 営業時間・便利情報を保存し、保存後の店舗情報を返す。
   * @param input 店舗・営業時間・便利情報・操作ID
   * @returns 成功: 保存後の店舗情報。失敗: INVALID_INPUT（details.field）/ SPOT_NOT_FOUND / CONFLICT / STORAGE_FAILED
   * @sideEffect 登録内容を保存する（利用者アプリにすぐ反映される）
   */
  async execute(input: SaveShopInfoInput): Promise<Result<CmsShopInfoDto>> {
    const log = logger.fn('execute', { spotId: input.spotId, operationId: input.operationId });
    const shop = findShop(this.deps.spots, input.spotId);
    if (!shop.ok) return log.fail(shop);
    const operationId = parseCmsOperationId(input.operationId);
    if (!operationId.ok) return log.fail(operationId);
    const loaded = await loadOverlayAndToday(this.deps);
    if (!loaded.ok) return log.fail(loaded);
    const { overlay, today } = loaded.value;
    if (overlay.processedOperationIds.includes(operationId.value)) return log.exit(ok(toShopInfoDto(this.deps, shop.value, overlay, today)), 'duplicate');
    const hours = createBusinessHours(input.hours);
    if (!hours.ok) return log.fail(hours);
    const amenities = parseAmenityInput(input.amenities);
    if (!amenities.ok) return log.fail(amenities);
    const edit: CmsSpotEdit = { spotId: shop.value.id, hours: formatBusinessHours(hours.value), amenities: amenities.value, updatedAt: this.deps.clock.now() };
    const spotEdits = [...overlay.spotEdits.filter((e) => e.spotId !== shop.value.id), edit];
    const saved = await writeOverlay({ deps: this.deps, overlay, operationId: operationId.value, next: { spotEdits, shopEvents: overlay.shopEvents } });
    if (!saved.ok) return log.fail(saved);
    log.info('店舗情報を保存しました', { spotId: shop.value.id, version: saved.value.version });
    return log.exit(ok(toShopInfoDto(this.deps, shop.value, saved.value, today)));
  }
}
