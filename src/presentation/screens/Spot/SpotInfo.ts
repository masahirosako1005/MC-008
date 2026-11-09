/**
 * @file スポット情報（presentation/screens/Spot 層）
 * 名前・種別・地区・現在地からの距離・状態、便利情報（「あり」の項目だけ ✓ 付きで）、営業時間、説明（CLAUDE.md 6.4、wireframes/04_spot）。
 * 便利情報は初回でも困らないための情報（基準A）なので説明より上に置く。
 */
import type { SpotDetailDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { distanceText } from '@/presentation/screens/Spot/spotDetailModel';
import { AMENITY_LABELS, AMENITY_ORDER, KIND_LABELS, STATUS_LABELS } from '@/presentation/shared/labels';

const logger = createLogger('presentation/screens/Spot/SpotInfo');

/**
 * 便利情報の一覧を作る（「あり」の項目だけを決まった順に出す。1つもなければ出さない）。
 * @param amenities スポットの便利情報の値
 * @returns ul 要素（data-testid="spot-amenities"）。該当なしは undefined
 */
function createAmenityList(amenities: readonly string[]): HTMLElement | undefined {
  const log = logger.fn('createAmenityList', { count: amenities.length });
  const items = AMENITY_ORDER.filter((amenity) => amenities.includes(amenity)).map((amenity): HTMLElement => {
    const label = AMENITY_LABELS[amenity];
    return h('li', { class: 'spot-amenity', dataset: { has: '1' }, attrs: { 'aria-label': `${label}：あり` } }, [`✓ ${label}`]);
  });
  if (items.length === 0) return log.exit(undefined);
  return log.exit(h('ul', { class: 'spot-amenities', attrs: { 'data-testid': 'spot-amenities', 'aria-label': '便利情報' } }, items));
}

/**
 * 見出し・補足・値の1行（営業時間など）を作る。
 * @param label 見出し
 * @param value 値
 * @returns div 要素
 */
export function createKeyValueRow(label: string, value: string | HTMLElement): HTMLElement {
  return h('div', { class: 'spot-kv' }, [h('span', { class: 'spot-kv__key', text: label }), h('span', { class: 'spot-kv__value' }, [value])]);
}

/**
 * スポット情報の塊を作る（data-testid="spot-info"）。
 * @param dto スポット詳細
 * @returns section 要素
 */
export function createSpotInfo(dto: SpotDetailDto): HTMLElement {
  const log = logger.fn('createSpotInfo', { spotId: dto.id, status: dto.status, meters: dto.meters });
  const title = h('h2', { class: 'spot-info__name' }, [
    h('span', { attrs: { 'data-testid': 'spot-name' }, text: dto.name }),
    h('span', { class: ['tag', 'tag--district'], text: KIND_LABELS[dto.kind] }),
    dto.partner ? h('span', { class: ['tag', 'tag--accent'], text: '店舗協力' }) : undefined,
  ]);
  const distance = h('b', {
    class: 'spot-info__distance',
    attrs: { 'data-testid': 'spot-distance', 'data-can-visit': dto.canVisit ? '1' : '0' },
    text: distanceText(dto.meters),
  });
  const meta = h('p', { class: 'spot-info__meta' }, [`${dto.districtName} ・ 現在地から `, distance, ` ・ ${STATUS_LABELS[dto.status]}`]);
  const section = h('section', { class: 'spot-info', attrs: { 'data-testid': 'spot-info', 'data-status': dto.status } }, [
    title,
    meta,
    createAmenityList(dto.amenities),
    h('div', { class: 'spot-facts' }, [createKeyValueRow('営業時間', dto.hours), createKeyValueRow('ジャンル', dto.category), h('p', { class: 'spot-info__desc', text: dto.description })]),
  ]);
  return log.exit(section);
}
