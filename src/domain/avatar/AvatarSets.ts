/**
 * @file アバターのコレクション（ご当地・季節のセット）の一覧（domain/avatar 層。固定データ）
 * 地区（土地）や季節にちなんだ部品の組み合わせ。セットとして手に入るのではなく、部品ごとに通った実績で手に入る（AvatarCatalog）。
 * 画面ではマネキンに着せて並べ、まだ持っていない部品の手に入れ方を見せる（B 未開拓への興味・C 再訪動機）。
 * 季節のセットは、その季節に通うと手に入る部品を中心にする（季節が変わったらまた来る理由になる）。
 */
import type { Season } from '@/Common/utils/date';
import type { CatalogDistrictId } from '@/domain/avatar/AvatarCatalog';

/** セットの種類 */
export type AvatarSetKind = 'region' | 'season';

/** セットの定義 */
export interface AvatarSetDef {
  /** 'set.<名前>' */
  readonly id: string;
  readonly name: string;
  readonly kind: AvatarSetKind;
  /** ご当地のセットの地区 */
  readonly districtId?: CatalogDistrictId;
  /** 季節のセットの季節 */
  readonly season?: Season;
  /** 部品ID（1枠1つ） */
  readonly partIds: readonly string[];
}

/** すべてのセット（並び＝表示順。ご当地 → 季節） */
export const AVATAR_SETS: readonly AvatarSetDef[] = Object.freeze([
  { id: 'set.minamimori', name: '天満宮まいり', kind: 'region', districtId: 'd_minamimori', partIds: ['top.umeKimono', 'hat.umeKanzashi', 'held.omamori', 'shoes.geta', 'background.minamimori'] },
  { id: 'set.tenma', name: '天神橋筋の食いだおれ', kind: 'region', districtId: 'd_tenma', partIds: ['top.apron', 'hat.hachimaki', 'held.kushikatsu', 'object.stall', 'background.tenma'] },
  { id: 'set.tenroku', name: '今昔館の町あるき', kind: 'region', districtId: 'd_tenroku', partIds: ['top.edoKimono', 'hat.sugegasa', 'held.kamifusen', 'shoes.geta', 'background.edo'] },
  { id: 'set.ogimachi', name: '中崎町レトロさんぽ', kind: 'region', districtId: 'd_ogimachi', partIds: ['top.retroOnepiece', 'hat.beret', 'held.filmcamera', 'accessory.glasses', 'background.nakazaki'] },
  { id: 'set.okawa', name: '大川の川辺', kind: 'region', districtId: 'd_okawa', partIds: ['top.sailor', 'hat.straw', 'held.fishing', 'pet.penguin', 'background.okawa'] },
  { id: 'set.spring', name: '桜の通り抜け', kind: 'season', season: 'spring', partIds: ['hat.sakuraKanzashi', 'top.haoriSakura', 'held.dango', 'pet.mejiro', 'aura.sakura', 'background.yozakura'] },
  { id: 'set.summer', name: '天神祭', kind: 'season', season: 'summer', partIds: ['top.tenjinYukata', 'hat.kitsuneMask', 'held.kingyo', 'shoes.geta', 'background.tenjinMatsuri'] },
  { id: 'set.autumn', name: '紅葉とお月見', kind: 'season', season: 'autumn', partIds: ['hat.momijiBeret', 'top.momijiPoncho', 'held.yakiimo', 'pet.tsukimiUsagi', 'background.momiji'] },
  { id: 'set.winter', name: 'うそかえと雪あそび', kind: 'season', season: 'winter', partIds: ['pet.uso', 'accessory.earmuffs', 'top.downcoat', 'held.yukidaruma', 'background.snowlight'] },
].map((s) => Object.freeze({ ...s, partIds: Object.freeze(s.partIds) })) as AvatarSetDef[]);
