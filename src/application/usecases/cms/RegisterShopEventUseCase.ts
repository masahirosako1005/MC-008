/**
 * @file 店舗CMS のクーポン・イベント登録ユースケース（application/usecases/cms 層・書込系）
 * 規則は domain/revisit/ShopEventDraft（協力店だけ・字数・期間・同時掲載の上限）。
 * フェーズ1（デモ）は運営者の確認を飛ばしてすぐ掲載する（docs/09 CMS-E05）。同じ操作ID の再送は何もしない（DI-07）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { AppError, Result } from '@/Common/result/Result';
import { parseShopEventId } from '@/Common/types/Id';
import type { ShopEventId } from '@/Common/types/Id';
import type { UseCase } from '@/application/AppServices';
import type { CmsShopInfoDto, RegisterShopEventInput } from '@/application/dto/CmsDto';
import type { CmsShopEventRecord } from '@/application/ports/CmsOverlayRepository';
import { findShop, liveEventPeriods, loadOverlayAndToday, parseCmsOperationId, toShopInfoDto, writeOverlay } from '@/application/usecases/cms/cmsShopView';
import type { CmsDeps } from '@/application/usecases/cms/cmsShopView';
import type { IdGenerator } from '@/domain/ports/IdGenerator';
import { validateShopEventDraft } from '@/domain/revisit/ShopEventDraft';

const logger = createLogger('application/usecases/cms/RegisterShopEventUseCase');

/** CMS で作る ID の乱数部分の長さ（ShopEventId は c_ + 2〜16字。マスタの 'c_mm01' 形式と重ならない長さ） */
const CMS_EVENT_ID_LENGTH = 14;

/**
 * CMS で登録するクーポン・イベントの ID を作る（暗号学的に安全な乱数＝SEC-12）。
 * @param ids ID の発行元
 * @returns 'c_' + 英数字14字
 */
export function newCmsShopEventId(ids: IdGenerator): Result<ShopEventId> {
  const log = logger.fn('newCmsShopEventId');
  const raw = ids.newId('c');
  const id = parseShopEventId(`c_${raw.slice(2, 2 + CMS_EVENT_ID_LENGTH)}`);
  return id.ok ? log.exit(id) : log.fail(id);
}

/** クーポン・イベントを登録する */
export class RegisterShopEventUseCase implements UseCase<RegisterShopEventInput, CmsShopInfoDto> {
  /**
   * 依存を受け取る。
   * @param deps マスタ・登録内容・時計・ID の発行元
   */
  constructor(private readonly deps: CmsDeps) {}

  /**
   * クーポン・イベントを登録し、登録後の店舗情報を返す。
   * @param input 店舗・種別・題名・説明・期間・操作ID
   * @returns 成功: 登録後の店舗情報。失敗: NOT_PARTNER / INVALID_INPUT（details.field）/ LIMIT_REACHED / SPOT_NOT_FOUND / CONFLICT / STORAGE_FAILED
   * @sideEffect 登録内容を保存する（利用者アプリの期限カード・スポット詳細にすぐ出る）
   */
  async execute(input: RegisterShopEventInput): Promise<Result<CmsShopInfoDto, AppError>> {
    const log = logger.fn('execute', { spotId: input.spotId, kind: input.kind, start: input.start, end: input.end });
    const shop = findShop(this.deps.spots, input.spotId);
    if (!shop.ok) return log.fail(shop);
    const operationId = parseCmsOperationId(input.operationId);
    if (!operationId.ok) return log.fail(operationId);
    const loaded = await loadOverlayAndToday(this.deps);
    if (!loaded.ok) return log.fail(loaded);
    const { overlay, today } = loaded.value;
    if (overlay.processedOperationIds.includes(operationId.value)) return log.exit(ok(toShopInfoDto(this.deps, shop.value, overlay, today)), 'duplicate');
    const existing = liveEventPeriods(this.deps.spots, overlay, shop.value.id);
    const draft = validateShopEventDraft({ ...input, spot: shop.value, today, existing });
    if (!draft.ok) return log.fail(draft);
    const id = newCmsShopEventId(this.deps.ids);
    if (!id.ok) return log.fail(id);
    const record: CmsShopEventRecord = {
      id: id.value, spotId: shop.value.id, kind: draft.value.kind, title: draft.value.title, description: draft.value.description,
      start: draft.value.period.start, end: draft.value.period.end, createdAt: this.deps.clock.now(),
    };
    const next = { spotEdits: overlay.spotEdits, shopEvents: [...overlay.shopEvents, record] };
    const saved = await writeOverlay({ deps: this.deps, overlay, operationId: operationId.value, next });
    if (!saved.ok) return log.fail(saved);
    log.info('クーポン・イベントを登録しました', { spotId: shop.value.id, shopEventId: record.id, kind: record.kind });
    return log.exit(ok(toShopInfoDto(this.deps, shop.value, saved.value, today)));
  }
}
