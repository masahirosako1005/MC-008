/**
 * @file 店舗CMS の店舗一覧ユースケース（application/usecases/cms 層・読取系）
 * デモではログインの代わりに、この一覧から店を選ぶ（docs/09 CMS-A09）。地区の表示順 → スポットID の順に並べる。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { CmsShopSummaryDto } from '@/application/dto/CmsDto';
import { editOf, liveEventPeriods, loadOverlayAndToday } from '@/application/usecases/cms/cmsShopView';
import type { CmsDeps } from '@/application/usecases/cms/cmsShopView';
import { countOpenEvents } from '@/domain/revisit/ShopEventDraft';

const logger = createLogger('application/usecases/cms/GetCmsShopsUseCase');

/** 店舗の一覧を返す */
export class GetCmsShopsUseCase implements UseCase<void, readonly CmsShopSummaryDto[]> {
  /**
   * 依存を受け取る。
   * @param deps マスタ・登録内容・時計
   */
  constructor(private readonly deps: Pick<CmsDeps, 'spots' | 'cmsOverlay' | 'clock'>) {}

  /**
   * 店舗の一覧を返す。
   * @returns 成功: 店舗の一覧（地区順）。失敗: STORAGE_FAILED
   */
  async execute(): Promise<Result<readonly CmsShopSummaryDto[]>> {
    const log = logger.fn('execute');
    const loaded = await loadOverlayAndToday(this.deps);
    if (!loaded.ok) return log.fail(loaded);
    const { overlay, today } = loaded.value;
    const shops: CmsShopSummaryDto[] = [];
    for (const district of this.deps.spots.allDistricts()) {
      const inDistrict = this.deps.spots.spotsInDistrict(district.id).filter((s) => s.kind === 'shop');
      for (const shop of [...inDistrict].sort((a, b) => a.id.localeCompare(b.id))) {
        shops.push({
          id: shop.id, name: shop.name, districtName: district.name, category: shop.category, partner: shop.partner,
          edited: editOf(overlay, shop.id) !== undefined,
          openEvents: countOpenEvents(liveEventPeriods(this.deps.spots, overlay, shop.id), today),
        });
      }
    }
    return log.exit(ok(shops), `count=${shops.length}`);
  }
}
