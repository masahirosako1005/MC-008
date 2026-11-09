/**
 * @file 地図に出す「おすすめ商品」と「今日だけ」の表（presentation/screens/Map/town 層）
 * 店ごとの看板商品（店の紹介文から1つ選んだもの）と、カテゴリの既定のアイコンを持つ。名所には見どころを付ける。
 * 地図だけでも「行けば楽しい場所」と分かるように、店の上に商品のドット絵アイコンを浮かべるために使う。
 * 今日だけ（todaySpecialOf）はデモ用の日替わり情報で、店ID と日付から決定論的に決める（乱数は使わない）。
 * 本来は店舗CMS（docs/09）で店が登録する情報。マスタに項目が入ったら、そちらを優先して置き換える。
 */
import { hashString } from '@/Common/ui/canvas/seededHash';
import type { GoodsIcon, LandmarkSprite } from '@/presentation/screens/Map/town/pixelSprites';

/** おすすめ商品（アイコンと商品名） */
export interface GoodsInfo {
  readonly icon: GoodsIcon;
  /** おすすめ商品名（例 '厚焼き玉子サンド'） */
  readonly label: string;
}

/** 今日だけの情報 */
export interface TodaySpecial {
  readonly title: string;
}

/** 表に無い店・カテゴリのときのおすすめ */
const DEFAULT_GOODS: GoodsInfo = { icon: 'gift', label: 'おすすめ' };

/** 店・名所ごとのおすすめ（ID → アイコンと商品名。紹介文から1つ選んだもの） */
const SPOT_GOODS: Readonly<Record<string, GoodsInfo>> = {
  // 南森町・天満宮地区
  s_mm01: { icon: 'sandwich', label: '厚焼き玉子サンド' },
  s_mm02: { icon: 'dorayaki', label: 'どら焼き' },
  s_mm03: { icon: 'tea', label: '抹茶と白玉ぜんざい' },
  s_mm04: { icon: 'bread', label: '塩パン' },
  s_mm05: { icon: 'takoyaki', label: 'すだち塩のたこ焼き' },
  s_mm06: { icon: 'book', label: '上方落語の古本' },
  s_mm07: { icon: 'sake', label: 'おでんと一杯' },
  s_mm08: { icon: 'croquette', label: '揚げたてコロッケ' },
  s_mm09: { icon: 'kimono', label: '和小物のがま口' },
  s_mm10: { icon: 'udon', label: 'きざみきつねうどん' },
  s_mm11: { icon: 'sushi', label: '市場の魚の握り' },
  s_mm12: { icon: 'gift', label: '梅柄の手ぬぐい' },
  s_mm13: { icon: 'veggie', label: '季節の果物' },
  s_mm14: { icon: 'latte', label: 'ほうじ茶ラテ' },
  // 天満地区
  s_tm01: { icon: 'kushikatsu', label: '串かつ' },
  s_tm02: { icon: 'fish', label: '刺身の盛り合わせ' },
  s_tm03: { icon: 'gyoza', label: 'ひと口餃子' },
  s_tm04: { icon: 'veggie', label: '旬の野菜と果物' },
  s_tm05: { icon: 'okonomiyaki', label: 'ふわふわお好み焼き' },
  s_tm06: { icon: 'pickles', label: '水なすの浅漬け' },
  s_tm07: { icon: 'kombu', label: 'かつお節と昆布' },
  s_tm08: { icon: 'sushi', label: '立ち寿司の一貫' },
  s_tm09: { icon: 'teishoku', label: '市場の朝ごはん' },
  s_tm10: { icon: 'sake', label: 'どて焼きと一杯' },
  s_tm11: { icon: 'yakitori', label: '炭火の塩焼き鳥' },
  s_tm12: { icon: 'croquette', label: '牛ミンチコロッケ' },
  s_tm13: { icon: 'bread', label: '国産小麦の食パン' },
  s_tm14: { icon: 'pot', label: '竹ざると鍋' },
  s_tm15: { icon: 'coffee', label: '自家製プリンと珈琲' },
  // 天六地区
  s_tr01: { icon: 'book', label: '昔の大阪の写真集' },
  s_tr02: { icon: 'dango', label: 'おはぎと餅菓子' },
  s_tr03: { icon: 'gift', label: '木の道具とかご' },
  s_tr04: { icon: 'bath', label: '薬湯でひと風呂' },
  s_tr05: { icon: 'udon', label: 'きつねうどん' },
  s_tr06: { icon: 'pencil', label: '天六のポストカード' },
  s_tr07: { icon: 'tofu', label: 'できたて寄せ豆腐' },
  s_tr08: { icon: 'veggie', label: '朝どれ野菜' },
  s_tr09: { icon: 'bread', label: 'カレーパン' },
  s_tr10: { icon: 'coffee', label: '厚切りトーストと珈琲' },
  s_tr11: { icon: 'hammer', label: '頼れる町の道具' },
  s_tr12: { icon: 'bento', label: '量り売りのお惣菜' },
  // 扇町・中崎町地区
  s_og01: { icon: 'parfait', label: 'ミックスジュース' },
  s_og02: { icon: 'sandwich', label: '具だくさんサンド' },
  s_og03: { icon: 'shirt', label: '昭和のワンピース' },
  s_og04: { icon: 'takoyaki', label: 'ポン酢のたこ焼き' },
  s_og05: { icon: 'vase', label: '作家ものの器' },
  s_og06: { icon: 'cake', label: '自家製ケーキ' },
  s_og07: { icon: 'book', label: '古本と珈琲' },
  s_og08: { icon: 'yarn', label: 'がま口づくり教室' },
  s_og09: { icon: 'painting', label: '切り絵のポストカード' },
  s_og10: { icon: 'candy', label: 'ラムネと駄菓子' },
  s_og11: { icon: 'udon', label: 'ぶっかけうどん' },
  s_og12: { icon: 'flower', label: '一輪の切り花' },
  // 大川沿い地区
  s_ok01: { icon: 'latte', label: '川を望むカフェラテ' },
  s_ok02: { icon: 'onigiri', label: '握りたておにぎり' },
  s_ok03: { icon: 'bicycle', label: '川沿いサイクリング' },
  s_ok04: { icon: 'cake', label: '桜のロールケーキ' },
  s_ok05: { icon: 'soba', label: '十割そば' },
  s_ok06: { icon: 'sake', label: '大阪の地酒' },
  s_ok07: { icon: 'dango', label: '花見だんご' },
  s_ok08: { icon: 'camera', label: '桜の記念撮影' },
  s_ok09: { icon: 'unagi', label: '関西風うな重' },
  s_ok10: { icon: 'parfait', label: '桜のかき氷' },
  s_ok11: { icon: 'gelato', label: '季節の果物ジェラート' },
  s_ok12: { icon: 'vase', label: '昭和の古道具' },
  s_ok13: { icon: 'okonomiyaki', label: '座敷で焼くお好み焼き' },
  // 名所（見どころ）
  l_mm01: { icon: 'flower', label: '梅の境内とお守り' },
  l_mm02: { icon: 'book', label: '上方落語の公演' },
  l_mm03: { icon: 'fish', label: '商売繁盛のえべっさん' },
  l_tm01: { icon: 'veggie', label: '市場の新鮮な食材' },
  l_tm02: { icon: 'croquette', label: 'アーケードの食べ歩き' },
  l_tm03: { icon: 'yakitori', label: '高架下のはしご酒' },
  l_tr01: { icon: 'kimono', label: '江戸の町並み体験' },
  l_tr02: { icon: 'takoyaki', label: '食べ歩きのスタート' },
  l_og01: { icon: 'sandwich', label: '芝生でピクニック' },
  l_og02: { icon: 'gift', label: '遊んで学べる展示' },
  l_og03: { icon: 'latte', label: '路地カフェめぐり' },
  l_ok01: { icon: 'flower', label: '桜の通り抜け' },
  l_ok02: { icon: 'camera', label: '明治の洋風建築' },
  l_ok03: { icon: 'onigiri', label: '桜並木でお花見' },
};

/** カテゴリの既定のおすすめ（店・名所のカテゴリ → アイコンと商品名） */
const CATEGORY_GOODS: Readonly<Record<string, GoodsInfo>> = {
  喫茶: { icon: 'coffee', label: '珈琲' },
  和菓子: { icon: 'dorayaki', label: '和菓子' },
  甘味処: { icon: 'tea', label: '甘味' },
  パン: { icon: 'bread', label: '焼きたてパン' },
  たこ焼き: { icon: 'takoyaki', label: 'たこ焼き' },
  古書: { icon: 'book', label: '古本' },
  立ち飲み: { icon: 'sake', label: '一杯' },
  精肉コロッケ: { icon: 'croquette', label: 'コロッケ' },
  呉服: { icon: 'kimono', label: '和小物' },
  うどん: { icon: 'udon', label: 'うどん' },
  寿司: { icon: 'sushi', label: 'にぎり' },
  雑貨: { icon: 'gift', label: '雑貨' },
  青果: { icon: 'veggie', label: '旬の野菜' },
  日本茶: { icon: 'tea', label: '日本茶' },
  串カツ: { icon: 'kushikatsu', label: '串かつ' },
  鮮魚: { icon: 'fish', label: '鮮魚' },
  餃子: { icon: 'gyoza', label: '餃子' },
  お好み焼き: { icon: 'okonomiyaki', label: 'お好み焼き' },
  漬物: { icon: 'pickles', label: '漬物' },
  乾物: { icon: 'kombu', label: 'だしの素材' },
  食堂: { icon: 'teishoku', label: '定食' },
  焼き鳥: { icon: 'yakitori', label: '焼き鳥' },
  台所道具: { icon: 'pot', label: '台所道具' },
  銭湯: { icon: 'bath', label: 'ひと風呂' },
  文具: { icon: 'pencil', label: '文具' },
  豆腐: { icon: 'tofu', label: '豆腐' },
  金物: { icon: 'hammer', label: '金物' },
  惣菜: { icon: 'bento', label: 'お惣菜' },
  古着: { icon: 'shirt', label: '古着' },
  カフェ: { icon: 'latte', label: 'カフェラテ' },
  手芸: { icon: 'yarn', label: '手芸' },
  ギャラリー: { icon: 'painting', label: '作品' },
  駄菓子: { icon: 'candy', label: '駄菓子' },
  花: { icon: 'flower', label: '季節の花' },
  おにぎり: { icon: 'onigiri', label: 'おにぎり' },
  レンタサイクル: { icon: 'bicycle', label: '貸し自転車' },
  洋菓子: { icon: 'cake', label: 'ケーキ' },
  そば: { icon: 'soba', label: 'そば' },
  酒店: { icon: 'sake', label: '地酒' },
  写真館: { icon: 'camera', label: '記念撮影' },
  うなぎ: { icon: 'unagi', label: 'うな重' },
  ジェラート: { icon: 'gelato', label: 'ジェラート' },
  古道具: { icon: 'vase', label: '古道具' },
  ラーメン: { icon: 'ramen', label: 'ラーメン' },
  // 名所のカテゴリ
  神社: { icon: 'flower', label: 'お参り' },
  寄席: { icon: 'book', label: '落語' },
  市場: { icon: 'veggie', label: '市場の食材' },
  商店街: { icon: 'croquette', label: '食べ歩き' },
  飲食街: { icon: 'yakitori', label: 'はしご酒' },
  博物館: { icon: 'gift', label: '展示' },
  公園: { icon: 'sandwich', label: 'ピクニック' },
  町並み: { icon: 'latte', label: '路地さんぽ' },
  名所: { icon: 'flower', label: '季節の景色' },
  建築: { icon: 'camera', label: '建物めぐり' },
};

/** 名所のカテゴリ → 建物の絵 */
const LANDMARK_SPRITES: Readonly<Record<string, LandmarkSprite>> = {
  神社: 'shrine',
  寄席: 'theater',
  市場: 'market',
  商店街: 'arcadeGate',
  飲食街: 'yokocho',
  博物館: 'museum',
  公園: 'park',
  町並み: 'alley',
  名所: 'sakuraGate',
  建築: 'western',
};

/** ひさしの色: しょっぱい食べ物（赤） */
const AWNING_SAVORY = '#e2574c';
/** ひさしの色: パン・喫茶（橙） */
const AWNING_BAKERY = '#f08c3a';
/** ひさしの色: 甘いもの（桃） */
const AWNING_SWEETS = '#e57fa3';
/** ひさしの色: お酒（紺） */
const AWNING_DRINK = '#34406b';
/** ひさしの色: 生鮮・お茶（緑） */
const AWNING_FRESH = '#5fb35a';
/** ひさしの色: 雑貨・手しごと（青緑） */
const AWNING_CRAFT = '#2fa39a';
/** ひさしの色: 本・道具・衣料（青） */
const AWNING_GOODS = '#3e6fb5';
/** ひさしの色: 文化・体験（紫） */
const AWNING_CULTURE = '#8c6bc8';

/** カテゴリ → ひさしの色 */
const AWNING_BY_CATEGORY: Readonly<Record<string, string>> = {
  たこ焼き: AWNING_SAVORY,
  精肉コロッケ: AWNING_SAVORY,
  うどん: AWNING_SAVORY,
  寿司: AWNING_SAVORY,
  串カツ: AWNING_SAVORY,
  鮮魚: AWNING_SAVORY,
  餃子: AWNING_SAVORY,
  お好み焼き: AWNING_SAVORY,
  食堂: AWNING_SAVORY,
  焼き鳥: AWNING_SAVORY,
  惣菜: AWNING_SAVORY,
  おにぎり: AWNING_SAVORY,
  そば: AWNING_SAVORY,
  うなぎ: AWNING_SAVORY,
  ラーメン: AWNING_SAVORY,
  パン: AWNING_BAKERY,
  喫茶: AWNING_BAKERY,
  カフェ: AWNING_BAKERY,
  和菓子: AWNING_SWEETS,
  甘味処: AWNING_SWEETS,
  洋菓子: AWNING_SWEETS,
  ジェラート: AWNING_SWEETS,
  駄菓子: AWNING_SWEETS,
  立ち飲み: AWNING_DRINK,
  酒店: AWNING_DRINK,
  青果: AWNING_FRESH,
  漬物: AWNING_FRESH,
  乾物: AWNING_FRESH,
  豆腐: AWNING_FRESH,
  日本茶: AWNING_FRESH,
  雑貨: AWNING_CRAFT,
  手芸: AWNING_CRAFT,
  花: AWNING_CRAFT,
  古書: AWNING_GOODS,
  文具: AWNING_GOODS,
  金物: AWNING_GOODS,
  台所道具: AWNING_GOODS,
  古道具: AWNING_GOODS,
  古着: AWNING_GOODS,
  呉服: AWNING_GOODS,
  ギャラリー: AWNING_CULTURE,
  写真館: AWNING_CULTURE,
  銭湯: AWNING_CULTURE,
  レンタサイクル: AWNING_CULTURE,
};

/** 今日だけを出す割合（店のうち 0..100） */
const TODAY_SPECIAL_PERCENT = 13;

/** できたて・焼きたての言い回しが合う商品名（食べ物）の手がかり */
const FRESH_FOOD_PATTERN = /パン|コロッケ|たこ焼き|焼き|餃子|お好み|ケーキ|どら焼き|サンド|おにぎり|だんご|おはぎ|豆腐|うどん|そば|寿司|握り|ジェラート/;

/**
 * 店・名所のおすすめ（アイコンと商品名）を返す。店ごとの表 → カテゴリの既定 → 'おすすめ' の順に引く。
 * @param spot スポット（ID・種別・カテゴリ）
 * @returns おすすめ
 */
export function goodsOf(spot: { readonly id: string; readonly kind: 'landmark' | 'shop'; readonly category?: string }): GoodsInfo { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ表引き
  const byId = SPOT_GOODS[spot.id];
  if (byId !== undefined) return byId;
  const byCategory = spot.category === undefined ? undefined : CATEGORY_GOODS[spot.category];
  return byCategory ?? DEFAULT_GOODS;
}

/**
 * 名所のカテゴリから建物の絵を返す（知らないカテゴリは博物館の洋館）。
 * @param category 名所のカテゴリ（例 '神社'）
 * @returns 建物の絵
 */
export function landmarkSpriteOf(category: string | undefined): LandmarkSprite { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ表引き
  return (category === undefined ? undefined : LANDMARK_SPRITES[category]) ?? 'museum';
}

/**
 * 店のひさしの色を返す（食べ物=暖色、甘いもの=桃、お酒=紺、生鮮=緑、手しごと=青緑、道具・本=青、文化=紫）。
 * @param category 店のカテゴリ
 * @returns '#rrggbb'
 */
export function awningColorOf(category: string | undefined): string { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ表引き
  return (category === undefined ? undefined : AWNING_BY_CATEGORY[category]) ?? AWNING_BAKERY;
}

/**
 * デモ用の日替わり「今日だけ」を返す。店の約25%に出し、名所には出さない。店ID と日付から決定論的に決める。
 * @param spotId スポットID
 * @param kind 種別
 * @param label おすすめ商品名（goodsOf の label）
 * @param today 今日（YYYY-MM-DD）
 * @returns 今日だけ（無ければ undefined）
 */
export function todaySpecialOf(spotId: string, kind: 'landmark' | 'shop', label: string, today: string): TodaySpecial | undefined { // audit-ignore: fnlog-missing 毎フレーム描画から呼ぶ純粋な表引き
  if (kind !== 'shop') return undefined;
  const hash = hashString(`${spotId}|${today}`);
  if (hash % 100 >= TODAY_SPECIAL_PERCENT) return undefined;
  const templates = [
    `${label} 今日だけ1割引`,
    `${label}をもう1つおまけ`,
    `本日限定 ${label}セット`,
    `今日だけ ${label}を特別価格で`,
  ];
  if (FRESH_FOOD_PATTERN.test(label)) templates.push(`できたての${label}あります`);
  const pick = templates[(hash >>> 8) % templates.length] ?? templates[0] ?? label;
  return { title: pick };
}
