/**
 * @file 店舗CMS の店舗情報ユースケース（application/usecases/cms 層・読取系）
 * 編集を重ねた営業時間・便利情報と、クーポン・イベント（マスタ＋CMS）を返す。入力の spotId は検証する（SEC-16）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { CmsShopInfoDto, CmsShopInput } from '@/application/dto/CmsDto';
import { findShop, loadOverlayAndToday, toShopInfoDto } from '@/application/usecases/cms/cmsShopView';
import type { CmsDeps } from '@/application/usecases/cms/cmsShopView';

const logger = createLogger('application/usecases/cms/GetCmsShopInfoUseCase');

/** 店舗の情報を返す */
export class GetCmsShopInfoUseCase implements UseCase<CmsShopInput, CmsShopInfoDto> {
  /**
   * 依存を受け取る。
   * @param deps マスタ・登録内容・時計
   */
  constructor(private readonly deps: Pick<CmsDeps, 'spots' | 'cmsOverlay' | 'clock'>) {}

  /**
   * 店舗の情報を返す。
   * @param input 店舗のスポットID
   * @returns 成功: 店舗の情報。失敗: INVALID_INPUT / SPOT_NOT_FOUND / STORAGE_FAILED
   */
  async execute(input: CmsShopInput): Promise<Result<CmsShopInfoDto>> {
    const log = logger.fn('execute', { spotId: input.spotId });
    const shop = findShop(this.deps.spots, input.spotId);
    if (!shop.ok) return log.fail(shop);
    const loaded = await loadOverlayAndToday(this.deps);
    if (!loaded.ok) return log.fail(loaded);
    return log.exit(ok(toShopInfoDto(this.deps, shop.value, loaded.value.overlay, loaded.value.today)));
  }
}
