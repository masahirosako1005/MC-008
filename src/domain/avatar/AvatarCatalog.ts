/**
 * @file アバターの部品の一覧（domain/avatar 層。固定データ）
 * 着せ替えで選べる部品（髪型・服・帽子・持ち物・相棒・背景・置くもの・称号など）と、その手に入れ方。
 * 手に入れ方はすべて「通った実績」（訪問記録から導出できる値）にする。報酬は網羅ではなく通いに出す（CLAUDE.md 4.6）。
 * 実績は追記専用の訪問記録から求めるので、一度手に入れた部品は失われない（地区の主のように奪われる条件は使わない＝CLAUDE.md 5 章）。
 * 回数のしきい値はすべて（仮）。部品ID は '<枠>.<種類>'。種類は presentation/shared/avatar/avatarLook.ts の型と同じ名前にする。
 */
import type { Season } from '@/Common/utils/date';

/** 部品の枠 */
export type AvatarSlot =
  | 'body' | 'hair' | 'hairColor' | 'eyes' | 'skin' | 'top' | 'topColor' | 'bottom' | 'shoes'
  | 'hat' | 'accessory' | 'held' | 'pet' | 'background' | 'object' | 'aura' | 'emote' | 'title';

/** すべての枠（表示順） */
export const AVATAR_SLOTS: readonly AvatarSlot[] = Object.freeze([
  'body', 'hair', 'hairColor', 'eyes', 'skin', 'top', 'topColor', 'bottom', 'shoes',
  'hat', 'accessory', 'held', 'pet', 'background', 'object', 'aura', 'emote', 'title',
] as const);

/** 何も着けない（はずす）ことができる枠 */
export const OPTIONAL_SLOTS: ReadonlySet<AvatarSlot> = new Set<AvatarSlot>(['hat', 'accessory', 'pet', 'object', 'aura', 'emote', 'title']);

/** 置くもの（object）の最大数 */
export const MAX_OBJECTS = 3;

/** 保存できるマイコーデの数 */
export const MAX_COORDS = 3;

/** レア度（N → SSR の順に手に入れにくい） */
export type AvatarRarity = 'N' | 'R' | 'SR' | 'SSR';

/** 地区ID（マスタ public/master/districts.json と同じ。テストで一致を確かめる） */
export type CatalogDistrictId = 'd_minamimori' | 'd_tenma' | 'd_tenroku' | 'd_ogimachi' | 'd_okawa';

/** 手に入れ方（すべて訪問記録から求まり、減らない） */
export type AvatarUnlock =
  | { readonly kind: 'free' }
  /** 通った回数の合計 */
  | { readonly kind: 'totalVisits'; readonly count: number }
  /** 通った日数（同じ日の訪問は1日） */
  | { readonly kind: 'visitDays'; readonly count: number }
  /** ある地区に通った回数 */
  | { readonly kind: 'districtVisits'; readonly districtId: CatalogDistrictId; readonly count: number }
  /** 訪れた地区の数 */
  | { readonly kind: 'districts'; readonly count: number }
  /** 訪れたちがうお店の数 */
  | { readonly kind: 'shops'; readonly count: number }
  /** 訪れたちがう名所の数 */
  | { readonly kind: 'landmarks'; readonly count: number }
  /** 銀カードの枚数 */
  | { readonly kind: 'silverCards'; readonly count: number }
  /** 金カードの枚数 */
  | { readonly kind: 'goldCards'; readonly count: number }
  /** 訪問で手に入るアイテム（domain/reward/ItemPolicy の ID） */
  | { readonly kind: 'item'; readonly itemId: string }
  /** ある季節に通った回数（地区を決めればその地区だけ）。季節は訪問した暦日の月で決まる（Common/utils/date の seasonOf） */
  | { readonly kind: 'seasonVisits'; readonly season: Season; readonly count: number; readonly districtId?: CatalogDistrictId };

/** 部品の定義 */
export interface AvatarPartDef {
  /** '<枠>.<種類>' */
  readonly id: string;
  readonly slot: AvatarSlot;
  readonly name: string;
  readonly rarity: AvatarRarity;
  readonly unlock: AvatarUnlock;
}

/** はじめから持っている */
const FREE: AvatarUnlock = Object.freeze({ kind: 'free' });
/** 通った回数の合計 */
const total = (count: number): AvatarUnlock => ({ kind: 'totalVisits', count });
/** 通った日数 */
const days = (count: number): AvatarUnlock => ({ kind: 'visitDays', count });
/** 地区に通った回数 */
const at = (districtId: CatalogDistrictId, count: number): AvatarUnlock => ({ kind: 'districtVisits', districtId, count });
/** ちがうお店の数 */
const shops = (count: number): AvatarUnlock => ({ kind: 'shops', count });
/** ちがう名所の数 */
const landmarks = (count: number): AvatarUnlock => ({ kind: 'landmarks', count });
/** 訪れた地区の数 */
const districts = (count: number): AvatarUnlock => ({ kind: 'districts', count });
/** 銀カードの枚数 */
const silver = (count: number): AvatarUnlock => ({ kind: 'silverCards', count });
/** 金カードの枚数 */
const gold = (count: number): AvatarUnlock => ({ kind: 'goldCards', count });
/** 訪問で手に入るアイテム */
const item = (itemId: string): AvatarUnlock => ({ kind: 'item', itemId });
/** 季節に通った回数（地区を決めればその地区だけ） */
const inSeason = (season: Season, count: number, districtId?: CatalogDistrictId): AvatarUnlock => (districtId === undefined ? { kind: 'seasonVisits', season, count } : { kind: 'seasonVisits', season, count, districtId });

/** 枠ごとの定義の元（[種類, 名前, レア度, 手に入れ方]） */
type Row = readonly [style: string, name: string, rarity: AvatarRarity, unlock: AvatarUnlock];

/** 枠ごとの部品（並び＝表示順。しきい値はすべて（仮）） */
const ROWS: Readonly<Record<AvatarSlot, readonly Row[]>> = {
  body: [
    ['neutral', '指定しない', 'N', FREE], ['girl', '女の子', 'N', FREE], ['boy', '男の子', 'N', FREE],
  ],
  hair: [
    ['short', 'ショート', 'N', FREE], ['bob', 'ボブ', 'N', FREE], ['long', 'ロング', 'N', FREE], ['ponytail', 'ポニーテール', 'N', FREE],
    ['bun', 'おだんご', 'R', total(3)], ['twintail', 'ツインテール', 'R', days(5)], ['curly', 'ふわふわパーマ', 'R', shops(3)],
    ['spiky', 'つんつんヘア', 'R', at('d_tenma', 3)], ['sidepart', '七三わけ', 'SR', landmarks(5)], ['braid', 'みつあみ', 'SR', at('d_ogimachi', 5)],
    ['wolf', 'ウルフカット', 'SR', total(15)], ['afro', 'もこもこアフロ', 'SSR', total(30)],
  ],
  hairColor: [
    ['black', 'くろ', 'N', FREE], ['brown', 'こげ茶', 'N', FREE], ['chestnut', 'くり色', 'N', FREE], ['milktea', 'ミルクティー', 'N', FREE],
    ['ash', 'アッシュ', 'R', total(5)], ['sakura', 'さくら色', 'R', at('d_okawa', 2)], ['mint', 'ミント', 'R', at('d_tenroku', 3)],
    ['fuji', 'ふじ色', 'SR', at('d_minamimori', 5)], ['silver', 'ぎん色', 'SR', silver(2)], ['kogane', 'こがね色', 'SSR', gold(1)],
  ],
  eyes: [
    ['smile', 'にっこり', 'N', FREE], ['round', 'ぱっちり', 'N', FREE], ['calm', 'おだやか', 'N', FREE],
    ['sharp', 'きりっ', 'R', total(2)], ['sleepy', 'ねむたげ', 'R', days(3)], ['wink', 'ウインク', 'R', shops(2)],
    ['sparkle', 'キラキラ', 'SR', landmarks(3)], ['star', 'ほしの目', 'SSR', days(12)],
  ],
  skin: [
    ['tone1', 'はだ 1', 'N', FREE], ['tone2', 'はだ 2', 'N', FREE], ['tone3', 'はだ 3', 'N', FREE],
    ['tone4', 'はだ 4', 'N', FREE], ['tone5', 'はだ 5', 'N', FREE], ['tone6', 'はだ 6', 'N', FREE],
  ],
  top: [
    ['tee', 'Tシャツ', 'N', FREE], ['hoodie', 'パーカー', 'N', FREE], ['shirt', 'シャツ', 'N', FREE],
    ['border', 'ボーダー', 'R', total(1)], ['knit', 'ざっくりニット', 'R', days(2)], ['cardigan', 'カーディガン', 'R', at('d_tenroku', 1)],
    ['sailor', 'マリンセーラー', 'R', at('d_okawa', 1)], ['happi', 'まつりのはっぴ', 'SR', at('d_tenma', 5)], ['apron', '市場のエプロン', 'SR', at('d_tenma', 7)],
    ['yukata', 'ゆかた', 'SR', at('d_minamimori', 3)], ['jacket', 'テーラードジャケット', 'SR', shops(5)], ['stadium', 'スタジャン', 'SR', at('d_ogimachi', 4)],
    ['kimono', '晴れ着', 'SSR', at('d_minamimori', 10)],
    ['umeKimono', '梅もようの着物', 'SR', at('d_minamimori', 7)], ['edoKimono', '今昔館の町娘きもの', 'SR', at('d_tenroku', 4)], ['retroOnepiece', '中崎町レトロワンピ', 'SR', at('d_ogimachi', 5)],
    ['haoriSakura', '桜の羽織', 'SR', inSeason('spring', 3)], ['tenjinYukata', '天神祭のゆかた', 'SR', inSeason('summer', 1, 'd_minamimori')],
    ['momijiPoncho', '紅葉のポンチョ', 'SR', inSeason('autumn', 5)], ['downcoat', 'もこもこダウン', 'SR', inSeason('winter', 3)],
  ],
  topColor: [
    ['sky', 'そら', 'N', FREE], ['coral', 'コーラル', 'N', FREE], ['navy', 'ネイビー', 'N', FREE], ['white', 'しろ', 'N', FREE],
    ['mustard', 'からし', 'N', FREE], ['leaf', 'わかば', 'N', FREE], ['lilac', 'ライラック', 'N', FREE], ['charcoal', 'すみ', 'N', FREE],
    ['sakura', 'さくら', 'R', at('d_okawa', 3)], ['gold', 'ゴールド', 'SSR', silver(3)],
  ],
  bottom: [
    ['denim', 'デニム', 'N', FREE], ['shorts', 'ショートパンツ', 'N', FREE], ['skirt', 'スカート', 'N', FREE],
    ['longskirt', 'ロングスカート', 'R', days(4)], ['cargo', 'カーゴパンツ', 'R', shops(4)], ['check', 'チェック柄', 'R', at('d_ogimachi', 2)],
    ['hakama', 'はかま', 'SR', at('d_minamimori', 6)], ['overall', 'オーバーオール', 'SR', at('d_tenroku', 3)],
  ],
  shoes: [
    ['sneaker', 'スニーカー', 'N', FREE], ['loafer', 'ローファー', 'N', FREE], ['boots', 'ブーツ', 'R', total(6)],
    ['sandal', 'サンダル', 'R', at('d_okawa', 2)], ['rain', '長ぐつ', 'R', days(6)], ['geta', 'げた', 'SR', at('d_minamimori', 4)],
    ['highcut', 'ハイカット', 'SR', total(20)],
  ],
  hat: [
    ['beret', 'ベレー帽', 'N', FREE], ['cap', 'キャップ', 'N', FREE], ['knit', 'ニット帽', 'R', total(4)],
    ['straw', '麦わら帽子', 'R', at('d_okawa', 2)], ['hachimaki', 'ハチマキ', 'R', at('d_tenma', 4)], ['bucket', 'バケットハット', 'R', shops(6)],
    ['flower', '花かんむり', 'SR', at('d_ogimachi', 4)], ['catEars', 'ねこみみ', 'SR', days(8)], ['silk', 'シルクハット', 'SR', landmarks(7)],
    ['tiara', 'ティアラ', 'SR', districts(3)],
    ['umeKanzashi', '梅のかんざし', 'R', at('d_minamimori', 4)], ['sugegasa', '菅笠', 'R', at('d_tenroku', 2)], ['sakuraKanzashi', '桜のかんざし', 'SR', inSeason('spring', 1, 'd_okawa')],
    ['kitsuneMask', 'きつねのお面', 'R', inSeason('summer', 1, 'd_tenma')], ['momijiBeret', '紅葉のベレー', 'R', inSeason('autumn', 1, 'd_ogimachi')], ['crown', '王冠', 'SSR', gold(1)], ['halo', '天使のわっか', 'SSR', total(40)],
  ],
  accessory: [
    ['glasses', 'まるメガネ', 'N', FREE], ['bandaid', 'ばんそうこう', 'N', FREE], ['headphones', 'ヘッドホン', 'R', shops(1)],
    ['ribbon', 'おおきなリボン', 'R', days(2)], ['scarf', 'スカーフ', 'R', at('d_ogimachi', 1)], ['muffler', 'マフラー', 'R', at('d_tenroku', 2)],
    ['sunglasses', 'サングラス', 'R', total(8)], ['heartglasses', 'ハートのサングラス', 'R', shops(3)], ['earmuffs', 'もこもこイヤーマフ', 'R', inSeason('winter', 1)], ['pochette', 'ポシェット', 'SR', at('d_tenma', 9)], ['medal', '金メダル', 'SSR', gold(2)],
    ['wings', '天使のはね', 'SSR', days(20)],
  ],
  held: [
    ['camera', 'カメラ', 'N', FREE], ['map', '紙の地図', 'N', FREE], ['guidebook', 'ガイドブック', 'N', total(1)],
    ['softcream', 'ソフトクリーム', 'R', at('d_tenma', 2)], ['takoyaki', 'たこ焼き', 'R', at('d_tenma', 6)], ['balloon', 'ふうせん', 'R', at('d_ogimachi', 2)],
    ['croquette', '揚げたてコロッケ', 'R', at('d_tenroku', 2)], ['fishing', 'つりざお', 'R', at('d_okawa', 4)], ['uchiwa', 'うちわ', 'R', days(7)],
    ['umbrella', '和がさ', 'SR', at('d_minamimori', 2)], ['wand', '星のステッキ', 'SR', landmarks(4)],
    ['omamori', 'おまもり', 'R', at('d_minamimori', 2)], ['kushikatsu', '串カツ', 'R', at('d_tenma', 4)], ['kamifusen', '紙風船', 'R', at('d_tenroku', 3)],
    ['filmcamera', 'フィルムカメラ', 'R', at('d_ogimachi', 3)], ['dango', '花見だんご', 'R', inSeason('spring', 1)], ['kingyo', '金魚すくいの金魚', 'R', inSeason('summer', 2)],
    ['yakiimo', '焼きいも', 'R', inSeason('autumn', 1, 'd_tenroku')], ['yukidaruma', 'ミニ雪だるま', 'R', inSeason('winter', 2)], ['bouquet', '花たば', 'SR', at('d_okawa', 3)],
    ['chochin', '提灯', 'SR', item('i_chochin')], ['nobori', 'のぼり', 'SR', item('i_nobori')], ['matsu', '松', 'SR', item('i_matsu')],
    ['sparkler', '手持ち花火', 'SSR', total(25)],
  ],
  pet: [
    ['hiyoko', 'ひよこ', 'N', total(1)], ['pigeon', 'はと', 'N', at('d_minamimori', 1)], ['cat', 'ねこ', 'R', total(10)],
    ['shiba', 'しばいぬ', 'R', at('d_ogimachi', 3)], ['rabbit', 'うさぎ', 'R', days(5)], ['tanuki', 'たぬき', 'SR', at('d_tenroku', 4)],
    ['penguin', 'ペンギン', 'SR', at('d_okawa', 6)], ['fox', '白ぎつね', 'SSR', at('d_minamimori', 8)], ['unicorn', 'ゆめユニコーン', 'SSR', days(15)],
    ['mejiro', 'メジロ', 'R', inSeason('spring', 2)], ['tsukimiUsagi', 'お月見うさぎ', 'SR', inSeason('autumn', 8)], ['uso', 'うそ鳥', 'SSR', inSeason('winter', 1, 'd_minamimori')], ['dragon', 'ちびドラゴン', 'SSR', gold(1)],
  ],
  background: [
    ['dreamy', 'ゆめかわの空', 'N', FREE], ['plain', 'パステル', 'N', FREE], ['room', 'マイルーム', 'N', FREE],
    ['minamimori', '天満宮の参道', 'R', at('d_minamimori', 1)], ['tenma', '天満の市場', 'R', at('d_tenma', 1)], ['tenroku', '天六の下町', 'R', at('d_tenroku', 1)],
    ['ogimachi', '扇町公園', 'R', at('d_ogimachi', 1)], ['okawa', '大川の桜並木', 'R', at('d_okawa', 1)],
    ['sunset', '夕焼けの川辺', 'SR', at('d_okawa', 4)], ['night', '夏まつりの夜', 'SR', days(10)], ['idol', 'キラキラステージ', 'SR', days(6)], ['starry', '満天の星空', 'SSR', total(35)],
    ['cafe', 'パステルカフェ', 'R', shops(4)], ['candy', 'おかしの国', 'R', at('d_tenma', 3)], ['beach', '夏の海', 'R', total(7)], ['aquarium', '水族館のトンネル', 'R', at('d_okawa', 3)],
    ['yozakura', '夜桜', 'SR', at('d_okawa', 5)], ['castle', 'おとぎのお城', 'SR', districts(4)], ['snowlight', '雪のイルミネーション', 'SR', days(11)], ['galaxy', 'ゆめの銀河', 'SSR', days(18)],
    ['edo', '今昔館の江戸の町', 'SR', at('d_tenroku', 5)], ['nakazaki', '中崎町のレトロ路地', 'R', at('d_ogimachi', 4)],
    ['momiji', '紅葉の公園', 'SR', inSeason('autumn', 2, 'd_ogimachi')], ['tenjinMatsuri', '天神祭の夜', 'SSR', inSeason('summer', 1, 'd_okawa')],
  ],
  object: [
    ['bench', 'ベンチ', 'N', FREE], ['plant', '観葉植物', 'N', FREE], ['postbox', 'ポスト', 'N', total(2)], ['heartballoon', 'ハートのバルーン', 'R', total(5)],
    ['bicycle', '自転車', 'R', total(3)], ['vending', '自動販売機', 'R', shops(2)], ['lamp', '街灯', 'R', days(3)],
    ['signboard', '立て看板', 'R', at('d_tenma', 2)], ['tanuki', 'たぬきの置物', 'R', at('d_tenroku', 2)], ['gacha', 'カプセルトイ', 'R', days(4)],
    ['lantern', '吊り提灯', 'R', at('d_minamimori', 5)], ['torii', '小さな鳥居', 'SR', at('d_minamimori', 3)], ['sakura', '桜の木', 'SR', at('d_okawa', 2)],
    ['maneki', '招きねこ', 'SR', shops(6)], ['dresser', 'ひみつのドレッサー', 'SR', days(9)], ['fountain', '噴水', 'SR', at('d_ogimachi', 6)], ['stall', '屋台', 'SR', at('d_tenma', 8)],
    ['fireworks', '打ち上げ花火', 'SSR', total(30)], ['trophy', '金のトロフィー', 'SSR', gold(1)],
  ],
  aura: [
    ['hearts', 'ハートオーラ', 'N', FREE], ['stars', 'スターオーラ', 'R', total(3)], ['notes', '音符オーラ', 'R', days(4)], ['sakura', '花びらオーラ', 'R', at('d_okawa', 2)],
    ['bubbles', 'シャボン玉', 'R', at('d_ogimachi', 2)], ['butterfly', 'ちょうちょ', 'SR', at('d_tenroku', 3)], ['snow', '雪のオーラ', 'SR', days(8)], ['moon', '月と星', 'SR', landmarks(6)],
    ['rainbow', '虹のリング', 'SSR', silver(3)], ['gold', '金のきらめき', 'SSR', gold(1)],
  ],
  emote: [
    ['love', 'ラブラブ', 'N', FREE], ['note', 'ルンルン', 'N', FREE], ['question', 'はてな', 'N', FREE],
    ['laugh', 'わはは', 'R', total(2)], ['surprise', 'びっくり', 'R', total(4)], ['sleepy', 'おねむ', 'R', days(3)], ['cry', 'うるうる', 'R', shops(2)],
    ['angry', 'ぷんぷん', 'R', districts(2)], ['bow', 'ぺこり', 'R', at('d_minamimori', 2)], ['cheer', 'おうえん', 'SR', days(7)],
    ['spin', 'くるくる', 'SR', total(12)], ['star', 'キラリ', 'SR', landmarks(5)], ['idol', 'アイドルダンス', 'SSR', total(28)],
  ],
  title: [
    ['newcomer', 'かけだし冒険者', 'N', FREE], ['walker', 'まち歩き見習い', 'N', total(1)], ['regular', '通いなれた人', 'R', days(5)],
    ['monzen', '参道の常連さん', 'R', at('d_minamimori', 5)], ['foodie', '天満の食いしんぼう', 'R', at('d_tenma', 5)], ['local', '天六のご近所さん', 'R', at('d_tenroku', 3)],
    ['stroller', '扇町のおさんぽ好き', 'R', at('d_ogimachi', 3)], ['riverside', '川辺のカメラマン', 'R', at('d_okawa', 2)],
    ['shopper', 'お店めぐり名人', 'SR', shops(6)], ['historian', '名所ハンター', 'SR', landmarks(7)], ['collector', '銀カードコレクター', 'SR', silver(3)],
    ['allarea', '5地区の冒険者', 'SSR', districts(5)], ['legend', '伝説の常連', 'SSR', gold(1)],
  ],
};

/** すべての部品（枠の表示順 → 枠の中の表示順。凍結済み） */
export const AVATAR_CATALOG: readonly AvatarPartDef[] = Object.freeze(
  AVATAR_SLOTS.flatMap((slot) => ROWS[slot].map(([style, name, rarity, unlock]) => Object.freeze({ id: `${slot}.${style}`, slot, name, rarity, unlock: Object.freeze(unlock) }))),
);

/** 部品ID → 定義 */
const BY_ID: ReadonlyMap<string, AvatarPartDef> = new Map(AVATAR_CATALOG.map((p) => [p.id, p]));

/**
 * 部品ID から定義を引く。
 * @param id 部品ID
 * @returns 定義（無ければ undefined）
 */
export function avatarPartOf(id: string): AvatarPartDef | undefined {
  return BY_ID.get(id);
}

/** 必ず1つ選ぶ枠の既定の部品（はじめから持っているもの） */
export const DEFAULT_PART_IDS: readonly string[] = Object.freeze([
  'body.neutral', 'hair.short', 'hairColor.black', 'eyes.smile', 'skin.tone2', 'top.tee', 'topColor.sky', 'bottom.denim', 'shoes.sneaker',
  'held.camera', 'background.dreamy',
]);
