/**
 * @file 店舗CMS のクーポン・イベント取り下げユースケース（application/usecases/cms 層・書込系）
 * 取り下げられるのは CMS で登録した、まだ終わっていないものだけ（マスタ同梱のものは対象外）。
 * 取り下げは「期間を前日までに短縮」として利用者アプリに配る（domain/revisit/ShopEventDraft.periodAfterWithdrawal）。
 * 利用者が期間中の訪問で得た提灯アイテムは消えない（docs/09 CMS-E08、失う体験を作らない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseShopEventId } from '@/Common/types/Id';
import { compareLocalDate } from '@/Common/utils/date';
import type { UseCase } from '@/application/AppServices';
import type { CmsShopInfoDto, WithdrawShopEventInput } from '@/application/dto/CmsDto';
import { findShop, loadOverlayAndToday, parseCmsOperationId, toShopInfoDto, writeOverlay } from '@/application/usecases/cms/cmsShopView';
import type { CmsDeps } from '@/application/usecases/cms/cmsShopView';

const logger = createLogger('application/usecases/cms/WithdrawShopEventUseCase');

/** CMS で登録したクーポン・イベントを取り下げる */
export class WithdrawShopEventUseCase implements UseCase<WithdrawShopEventInput, CmsShopInfoDto> {
  /**
   * 依存を受け取る。
   * @param deps マスタ・登録内容・時計
   */
  constructor(private readonly deps: Pick<CmsDeps, 'spots' | 'cmsOverlay' | 'clock'>) {}

  /**
   * 取り下げて、取り下げ後の店舗情報を返す。
   * @param input 店舗・クーポン/イベントの ID・操作ID
   * @returns 成功: 取り下げ後の店舗情報。失敗: INVALID_INPUT（無い・取り下げ済み・終了済み）/ SPOT_NOT_FOUND / CONFLICT / STORAGE_FAILED
   * @sideEffect 登録内容を保存する
   */
  async execute(input: WithdrawShopEventInput): Promise<Result<CmsShopInfoDto>> {
    const log = logger.fn('execute', { spotId: input.spotId, shopEventId: input.shopEventId });
    const shop = findShop(this.deps.spots, input.spotId);
    if (!shop.ok) return log.fail(shop);
    const eventId = parseShopEventId(input.shopEventId);
    if (!eventId.ok) return log.fail(eventId);
    const operationId = parseCmsOperationId(input.operationId);
    if (!operationId.ok) return log.fail(operationId);
    const loaded = await loadOverlayAndToday(this.deps);
    if (!loaded.ok) return log.fail(loaded);
    const { overlay, today } = loaded.value;
    if (overlay.processedOperationIds.includes(operationId.value)) return log.exit(ok(toShopInfoDto(this.deps, shop.value, overlay, today)), 'duplicate');
    const target = overlay.shopEvents.find((r) => r.id === eventId.value && r.spotId === shop.value.id);
    if (target === undefined || target.withdrawnOn !== undefined || compareLocalDate(target.end, today) < 0) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '取り下げできるクーポン・イベントではありません', { field: 'shopEventId' })));
    }
    const shopEvents = overlay.shopEvents.map((r) => (r.id === target.id ? { ...r, withdrawnOn: today } : r));
    const saved = await writeOverlay({ deps: this.deps, overlay, operationId: operationId.value, next: { spotEdits: overlay.spotEdits, shopEvents } });
    if (!saved.ok) return log.fail(saved);
    log.info('クーポン・イベントを取り下げました', { spotId: shop.value.id, shopEventId: target.id });
    return log.exit(ok(toShopInfoDto(this.deps, shop.value, saved.value, today)));
  }
}
