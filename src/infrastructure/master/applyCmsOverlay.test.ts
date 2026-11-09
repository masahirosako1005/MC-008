/**
 * @file 店舗CMS の登録内容をマスタに重ねる処理のテスト（infrastructure/master 層。docs/09 APP-11）
 * 実マスタに、正しい登録・改ざんされた登録を重ね、マスタと同じ規則で捨てられることを確かめる。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { OperationId, ShopEventId, SpotId } from '@/Common/types/Id';
import type { Instant, LocalDate } from '@/Common/utils/date';
import type { CmsOverlayData, CmsShopEventRecord } from '@/application/ports/CmsOverlayRepository';
import { SHOP_EVENT_DESCRIPTION_MAX, SHOP_EVENT_TITLE_MAX } from '@/domain/revisit/constants';
import { HOURS_TEXT_MAX } from '@/domain/spot/BusinessHours';
import { applyCmsOverlay } from '@/infrastructure/master/applyCmsOverlay';
import { MasterDataLoader } from '@/infrastructure/master/MasterDataLoader';
import { TEXT_LIMITS } from '@/infrastructure/master/masterRecordParsers';
import type { SpotCatalog } from '@/infrastructure/master/masterValidators';

const MASTER_DIR = resolve(process.cwd(), 'public/master');
const CREATED = '2026-11-09T01:00:00.000Z' as Instant;

/** テスト用: public/master の実ファイルを読む取得関数 */
async function fetchFromDisk(fileName: string): Promise<Result<string>> {
  try {
    return ok(readFileSync(resolve(MASTER_DIR, fileName), 'utf8'));
  } catch (error) {
    return fail(AppError.of('MASTER_FETCH_FAILED', 'x', { fileName }, error));
  }
}

/** テスト用: CMS のクーポン */
function coupon(overrides: Partial<CmsShopEventRecord> = {}): CmsShopEventRecord {
  return {
    id: 'c_cms0001' as ShopEventId, spotId: 's_mm04' as SpotId, kind: 'coupon', title: 'パン1個おまけ', description: 'x',
    start: '2026-11-09' as LocalDate, end: '2026-11-13' as LocalDate, createdAt: CREATED, ...overrides,
  };
}

/** テスト用: 登録内容 */
function overlay(data: Partial<CmsOverlayData>): CmsOverlayData {
  return { spotEdits: [], shopEvents: [], processedOperationIds: [] as OperationId[], ...data };
}

let catalog: SpotCatalog;

beforeAll(async () => {
  const loaded = await MasterDataLoader.load(fetchFromDisk);
  if (!loaded.ok) throw new Error(loaded.error.code);
  catalog = loaded.value.catalog;
});

describe('applyCmsOverlay', () => {
  it('CMS の字数の上限はマスタの検証（TEXT_LIMITS）と同じ値（規則を1か所に）', () => {
    expect(SHOP_EVENT_TITLE_MAX).toBe(TEXT_LIMITS.eventTitle);
    expect(SHOP_EVENT_DESCRIPTION_MAX).toBe(TEXT_LIMITS.eventDescription);
    expect(HOURS_TEXT_MAX).toBe(TEXT_LIMITS.hours);
  });

  it('協力店の営業時間・便利情報とクーポンを重ね、地区はスポットから決める', () => {
    const result = applyCmsOverlay(catalog, overlay({
      spotEdits: [{ spotId: 's_mm04' as SpotId, hours: '8:00–17:00（無休）', amenities: ['parking'], updatedAt: CREATED }],
      shopEvents: [coupon()],
    }));
    expect(result.rejected).toBe(0);
    const spot = result.catalog.spots.find((s) => s.id === 's_mm04');
    expect(spot?.hours).toBe('8:00–17:00（無休）');
    expect(spot?.amenities).toEqual(['parking']);
    const added = result.catalog.shopEvents.find((e) => e.id === 'c_cms0001');
    expect(added?.districtId).toBe(spot?.districtId);
    expect(result.catalog.shopEvents).toHaveLength(catalog.shopEvents.length + 1);
  });

  it('協力店でない店・名所・存在しない店・マスタと同じ ID・字数超過のクーポンは捨てる', () => {
    const nonPartner = catalog.spots.find((s) => s.kind === 'shop' && !s.partner)?.id ?? ('s_xx01' as SpotId);
    const result = applyCmsOverlay(catalog, overlay({
      shopEvents: [
        coupon({ id: 'c_cms0002' as ShopEventId, spotId: nonPartner }),
        coupon({ id: 'c_cms0003' as ShopEventId, spotId: 'l_mm01' as SpotId }),
        coupon({ id: 'c_cms0004' as ShopEventId, spotId: 's_zz99' as SpotId }),
        coupon({ id: 'c_mm01' as ShopEventId }),
        coupon({ id: 'c_cms0005' as ShopEventId, title: 'あ'.repeat(31) }),
      ],
    }));
    expect(result.rejected).toBe(5);
    expect(result.catalog.shopEvents).toHaveLength(catalog.shopEvents.length);
  });

  it('名所の編集・長すぎる営業時間は捨ててマスタのまま、取り下げは前日までに短縮する', () => {
    const result = applyCmsOverlay(catalog, overlay({
      spotEdits: [
        { spotId: 'l_mm01' as SpotId, hours: '9:00–17:00（無休）', updatedAt: CREATED },
        { spotId: 's_mm01' as SpotId, hours: 'あ'.repeat(41), updatedAt: CREATED },
      ],
      shopEvents: [coupon({ start: '2026-11-05' as LocalDate, end: '2026-11-20' as LocalDate, withdrawnOn: '2026-11-09' as LocalDate })],
    }));
    expect(result.rejected).toBe(2);
    expect(result.catalog.spots.find((s) => s.id === 'l_mm01')).toEqual(catalog.spots.find((s) => s.id === 'l_mm01'));
    expect(result.catalog.shopEvents.find((e) => e.id === 'c_cms0001')?.period.toJSON()).toEqual({ start: '2026-11-05', end: '2026-11-08' });
  });
});
