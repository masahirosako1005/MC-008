/**
 * @file 地区カードの一覧（presentation/screens/Map/Sheet 層）
 * 下シート「全画面」で、5地区の状態（成長Lv・色あせ・地区の主・次の目標）を地区カードで並べる（CLAUDE.md 6.3・11）。
 * 色あせ中でも Lv はそのまま表示する（色あせは見た目だけ＝4.3）。カレンダー追加は PoC では出さない（docs/08 §8）。
 */
import type { DistrictCardDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { createDistrictCard } from '@/Common/ui/cards/DistrictCard';
import { h } from '@/Common/ui/dom';
import { districtSubText, lordLabelOf } from '@/presentation/screens/Map/Sheet/sheetModel';
import { fadeLabel } from '@/presentation/shared/labels';

const logger = createLogger('presentation/screens/Map/Sheet/DistrictCardList');

/**
 * 地区カードの一覧を作る（data-testid="district-list"）。
 * @param districts 地区カード（application が地区の表示順で返す）
 * @param onDistrict 地区カードが押されたとき（地区ID を渡す）
 * @returns 一覧の要素
 */
export function createDistrictCardList(districts: readonly DistrictCardDto[], onDistrict: (districtId: string) => void): HTMLElement {
  const log = logger.fn('createDistrictCardList', { count: districts.length });
  const cards = districts.map((district) =>
    createDistrictCard({
      name: district.name,
      color: district.color,
      level: district.level,
      fadeKind: district.fade.kind,
      fadeProgress: district.fade.progress,
      fadeLabel: fadeLabel(district.fade),
      lordLabel: lordLabelOf(district),
      isLordMe: district.isLordMe,
      lordLost: district.lordLost,
      nextGoalText: districtSubText(district),
      districtId: district.id,
      onClick: (): void => onDistrict(district.id),
    }),
  );
  return log.exit(h('div', { class: 'map-sheet__list', attrs: { 'data-testid': 'district-list' } }, cards));
}
