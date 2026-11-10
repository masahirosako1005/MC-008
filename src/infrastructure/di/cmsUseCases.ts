/**
 * @file 店舗CMS のユースケース一式を組み立てる（infrastructure/di 層）
 * ブラウザだけの CMS（cmsContainer.ts。LocalStorage）と、連携サーバー（serverContainer.ts。SQLite）が同じ組み立てを使う。
 * どちらでも同じユースケースが同じ規則で動く（違うのは保存先と時計だけ）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { CmsServices } from '@/application/CmsServices';
import type { CmsDeps } from '@/application/usecases/cms/cmsShopView';
import { GetCmsShopInfoUseCase } from '@/application/usecases/cms/GetCmsShopInfoUseCase';
import { GetCmsSurveyUseCase } from '@/application/usecases/cms/GetCmsSurveyUseCase';
import { GetCmsShopsUseCase } from '@/application/usecases/cms/GetCmsShopsUseCase';
import { GetCmsVisitStatsUseCase } from '@/application/usecases/cms/GetCmsVisitStatsUseCase';
import { RegisterShopEventUseCase } from '@/application/usecases/cms/RegisterShopEventUseCase';
import { ResetCmsDemoUseCase } from '@/application/usecases/cms/ResetCmsDemoUseCase';
import { SaveShopInfoUseCase } from '@/application/usecases/cms/SaveShopInfoUseCase';
import { WithdrawShopEventUseCase } from '@/application/usecases/cms/WithdrawShopEventUseCase';

const logger = createLogger('infrastructure/di/cmsUseCases');

/**
 * 店舗CMS のユースケース一式を作る。
 * @param deps マスタ（上書き前）・登録内容の保存先・時計・ID の発行元
 * @returns CmsServices
 */
export function buildCmsUseCases(deps: CmsDeps): CmsServices {
  const log = logger.fn('buildCmsUseCases');
  return log.exit({
    shops: new GetCmsShopsUseCase(deps),
    shopInfo: new GetCmsShopInfoUseCase(deps),
    saveShopInfo: new SaveShopInfoUseCase(deps),
    registerShopEvent: new RegisterShopEventUseCase(deps),
    withdrawShopEvent: new WithdrawShopEventUseCase(deps),
    visitStats: new GetCmsVisitStatsUseCase(deps),
    survey: new GetCmsSurveyUseCase(deps),
    resetDemo: new ResetCmsDemoUseCase(deps),
  });
}
