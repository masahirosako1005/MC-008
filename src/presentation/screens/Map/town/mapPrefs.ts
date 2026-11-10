/**
 * @file 地図の「好み」「行きたい」とフィルタの判定（presentation/screens/Map/town 層）
 * 好み（カフェ・甘いもの…・トイレなど）と「行きたい」に入れたスポット・便利施設を端末に保存し、地図での強調に使う（A 初回満足度・B 未開拓への興味）。
 * 保存先は localStorage の `${STORAGE_PREFIX}map.prefs`（デモは別の名前空間）。読み込みは境界で検証し、壊れた値は空の好みとして扱う。
 * 個人の移動履歴は保存しない（ID と好みの種類だけ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { STORAGE_PREFIX } from '@/Common/constants/env';

const logger = createLogger('presentation/screens/Map/town/mapPrefs');

/** 地図のフィルタ（上端のチップ） */
export type MapFilterId = 'today' | 'stroller' | 'toilet' | 'kids' | 'rainOk' | 'want';

/** フィルタの表示名（label はチップ・読み上げ、short は狭いところ用） */
export const MAP_FILTERS: readonly { readonly id: MapFilterId; readonly label: string; readonly short: string }[] = [
  { id: 'today', label: '今日だけ', short: '今日' },
  { id: 'stroller', label: 'ベビーカーOK', short: 'ベビーカー' },
  { id: 'toilet', label: 'トイレ', short: 'トイレ' },
  { id: 'kids', label: '子連れ歓迎', short: '子連れ' },
  { id: 'rainOk', label: '雨の日OK', short: '雨の日' },
  { id: 'want', label: '行きたい・好み', short: '行きたい' },
];

/** 好みの種類 */
export type InterestId = 'cafe' | 'sweets' | 'bread' | 'meal' | 'drink' | 'shopping' | 'culture' | 'toilet' | 'stroller' | 'kids';

/** 好みの表示名（好みパネルのチップに使う。アイコンは mapLineIcons の同じ名前の線の絵） */
export const INTERESTS: readonly { readonly id: InterestId; readonly label: string }[] = [
  { id: 'cafe', label: 'カフェ・喫茶' },
  { id: 'sweets', label: '甘いもの' },
  { id: 'bread', label: 'パン' },
  { id: 'meal', label: 'ごはん・食べ歩き' },
  { id: 'drink', label: 'お酒' },
  { id: 'shopping', label: '買い物・雑貨' },
  { id: 'culture', label: '名所・文化' },
  { id: 'toilet', label: 'トイレ' },
  { id: 'stroller', label: 'ベビーカーOK' },
  { id: 'kids', label: '子連れ歓迎' },
];

/** 好みと「行きたい」 */
export interface MapPrefs {
  readonly interests: readonly InterestId[];
  /** 「行きたい」に入れたスポットID・便利施設ID（入れた順） */
  readonly wants: readonly string[];
}

/** 何も選んでいない好み */
export const EMPTY_PREFS: MapPrefs = Object.freeze({ interests: Object.freeze([]), wants: Object.freeze([]) });

/** 保存キー（STORAGE_PREFIX の後ろ） */
export const MAP_PREFS_KEY_SUFFIX = 'map.prefs';
/** 「行きたい」の最大件数（これを超えた分は古いものから捨てる） */
export const MAX_WANTS = 100;
/** 「行きたい」に入れられる ID の形（例 s_mm01・l_tm02・a_wc01） */
export const WANT_ID_PATTERN = /^[a-z]_[a-z0-9_]+$/;
/** ID の最大長（境界での検証） */
const MAX_ID_LENGTH = 40;

/** スポットのカテゴリ → 好み */
const CATEGORY_INTERESTS: Readonly<Record<string, InterestId>> = {
  喫茶: 'cafe',
  カフェ: 'cafe',
  日本茶: 'cafe',
  和菓子: 'sweets',
  甘味処: 'sweets',
  洋菓子: 'sweets',
  ジェラート: 'sweets',
  駄菓子: 'sweets',
  パン: 'bread',
  うどん: 'meal',
  寿司: 'meal',
  食堂: 'meal',
  そば: 'meal',
  うなぎ: 'meal',
  たこ焼き: 'meal',
  お好み焼き: 'meal',
  餃子: 'meal',
  串カツ: 'meal',
  焼き鳥: 'meal',
  おにぎり: 'meal',
  惣菜: 'meal',
  精肉コロッケ: 'meal',
  立ち飲み: 'drink',
  酒店: 'drink',
  雑貨: 'shopping',
  古書: 'shopping',
  古着: 'shopping',
  文具: 'shopping',
  手芸: 'shopping',
  呉服: 'shopping',
  台所道具: 'shopping',
  金物: 'shopping',
  古道具: 'shopping',
  花: 'shopping',
  青果: 'shopping',
  鮮魚: 'shopping',
  漬物: 'shopping',
  乾物: 'shopping',
  豆腐: 'shopping',
  ギャラリー: 'culture',
  写真館: 'culture',
  銭湯: 'culture',
};

/** 便利情報 → 好み */
const AMENITY_INTERESTS: Readonly<Record<string, InterestId>> = { toilet: 'toilet', stroller: 'stroller', kids: 'kids' };

/** 好み・フィルタの判定に使うスポットの情報 */
export interface PrefsSpot {
  readonly kind: 'landmark' | 'shop';
  readonly category?: string;
  readonly amenities: readonly string[];
}

/** フィルタの判定に使うスポットの情報（today は「今日だけ」などの今日の情報があるか） */
export interface FilterSpot extends PrefsSpot {
  readonly id: string;
  readonly today: boolean;
}

/**
 * 値が「行きたい」に入れられる ID か判定する（文字種と長さ）。
 * @param value 判定する値
 * @returns 正しい形の ID なら true
 */
export function isWantId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && WANT_ID_PATTERN.test(value);
}

/**
 * 外部から読んだ値を好みに直す（未知の好み・不正な ID・重複を捨て、行きたいは新しい MAX_WANTS 件まで）。
 * @param raw JSON.parse した値
 * @returns 検証済みの好み（形が違えば EMPTY_PREFS）
 */
export function parseMapPrefs(raw: unknown): MapPrefs {
  const log = logger.fn('parseMapPrefs');
  if (typeof raw !== 'object' || raw === null) return log.exit(EMPTY_PREFS, '形が違う');
  const record = raw as Record<string, unknown>;
  const interestsRaw = Array.isArray(record.interests) ? (record.interests as unknown[]) : [];
  const wantsRaw = Array.isArray(record.wants) ? (record.wants as unknown[]) : [];
  const interests = INTERESTS.map((item) => item.id).filter((id) => interestsRaw.includes(id));
  const wants = uniqueStrings(wantsRaw.filter(isWantId)).slice(-MAX_WANTS);
  return log.exit({ interests, wants }, `好み${interests.length}件・行きたい${wants.length}件`);
}

/**
 * 文字列の重複を、最初に出た順を保って取り除く。
 * @param values 文字列
 * @returns 重複のない配列
 */
function uniqueStrings(values: readonly string[]): string[] {
  const log = logger.fn('uniqueStrings', { count: values.length });
  return log.exit([...new Set(values)]);
}

/**
 * 使える localStorage を返す（無い環境・アクセス拒否は undefined）。
 * @returns Storage
 */
function storage(): Storage | undefined {
  const log = logger.fn('storage');
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    return log.exit(store === undefined || store === null ? undefined : store);
  } catch {
    return log.fail(undefined, 'localStorage を使えません');
  }
}

/**
 * 保存キーを返す（デモは nnishi.demo. の名前空間）。
 * @returns キー
 */
export function mapPrefsKey(): string {
  return `${STORAGE_PREFIX}${MAP_PREFS_KEY_SUFFIX}`;
}

/**
 * 保存した好みを読み込む（無い・壊れている・読めないときは空の好み）。
 * @returns 好み
 * @sideEffect localStorage を読む
 */
export function loadMapPrefs(): MapPrefs {
  const log = logger.fn('loadMapPrefs');
  const store = storage();
  if (store === undefined) return log.exit(EMPTY_PREFS, '保存先なし');
  try {
    const text = store.getItem(mapPrefsKey());
    if (text === null) return log.exit(EMPTY_PREFS, '未保存');
    return log.exit(parseMapPrefs(JSON.parse(text)));
  } catch {
    return log.fail(EMPTY_PREFS, '好みを読めませんでした');
  }
}

/**
 * 好みを保存する（保存できなくても例外は出さない。地図の強調はその場で反映済み）。
 * @param prefs 好み
 * @sideEffect localStorage に書く
 */
export function saveMapPrefs(prefs: MapPrefs): void {
  const log = logger.fn('saveMapPrefs', { interests: prefs.interests.length, wants: prefs.wants.length });
  const store = storage();
  if (store === undefined) return log.exit(undefined, '保存先なし');
  try {
    const clean = parseMapPrefs(prefs);
    store.setItem(mapPrefsKey(), JSON.stringify({ interests: clean.interests, wants: clean.wants }));
    log.exit(undefined);
  } catch {
    log.fail(undefined, '好みを保存できませんでした');
  }
}

/**
 * 「行きたい」を入れ替える（入っていれば外し、無ければ末尾に足す。不正な ID は何もしない）。
 * @param prefs 今の好み
 * @param id スポットID・便利施設ID
 * @returns 新しい好み
 */
export function toggleWant(prefs: MapPrefs, id: string): MapPrefs {
  const log = logger.fn('toggleWant', { id });
  if (!isWantId(id)) return log.fail(prefs, '不正な ID');
  const has = prefs.wants.includes(id);
  const wants = has ? prefs.wants.filter((w) => w !== id) : [...prefs.wants, id].slice(-MAX_WANTS);
  return log.exit({ interests: prefs.interests, wants }, has ? '外した' : '入れた');
}

/**
 * 好みを入れ替える（並びは INTERESTS の順にそろえる）。
 * @param prefs 今の好み
 * @param id 好み
 * @returns 新しい好み
 */
export function toggleInterest(prefs: MapPrefs, id: InterestId): MapPrefs {
  const log = logger.fn('toggleInterest', { id });
  const has = prefs.interests.includes(id);
  const interests = INTERESTS.map((item) => item.id).filter((x) => (x === id ? !has : prefs.interests.includes(x)));
  return log.exit({ interests, wants: prefs.wants }, has ? '外した' : '入れた');
}

/**
 * スポットが当てはまる好みを返す（カテゴリ・名所・便利情報から）。
 * @param spot スポットの種別・カテゴリ・便利情報
 * @returns 好み（重複なし。INTERESTS の順）
 */
export function interestsOfSpot(spot: PrefsSpot): readonly InterestId[] { // audit-ignore: fnlog-missing 毎フレーム描画（地図の強調判定）で呼ぶ純粋な判定ヘルパー
  const found = new Set<InterestId>();
  if (spot.kind === 'landmark') found.add('culture');
  const byCategory = spot.category === undefined ? undefined : CATEGORY_INTERESTS[spot.category];
  if (byCategory !== undefined) found.add(byCategory);
  for (const amenity of spot.amenities) {
    const byAmenity = AMENITY_INTERESTS[amenity];
    if (byAmenity !== undefined) found.add(byAmenity);
  }
  return INTERESTS.map((item) => item.id).filter((id) => found.has(id));
}

/**
 * スポットが選んだ好みのどれかに当てはまるか。
 * @param spot スポットの種別・カテゴリ・便利情報
 * @param prefs 好み
 * @returns 当てはまれば true（好みを1つも選んでいなければ false）
 */
export function matchesInterests(spot: PrefsSpot, prefs: MapPrefs): boolean { // audit-ignore: fnlog-missing 毎フレーム描画（地図の強調判定）で呼ぶ純粋な判定ヘルパー
  if (prefs.interests.length === 0) return false;
  return interestsOfSpot(spot).some((id) => prefs.interests.includes(id));
}

/**
 * スポットがフィルタに当てはまるか（今日だけ＝今日の情報あり、行きたい・好み＝行きたいに入れた or 好みに合う、ほかは便利情報）。
 * @param filter フィルタ
 * @param spot スポット
 * @param prefs 好み
 * @returns 当てはまれば true
 */
export function matchesFilter(filter: MapFilterId, spot: FilterSpot, prefs: MapPrefs): boolean { // audit-ignore: fnlog-missing 毎フレーム描画（地図の強調判定）で呼ぶ純粋な判定ヘルパー
  switch (filter) {
    case 'today':
      return spot.today;
    case 'want':
      return prefs.wants.includes(spot.id) || matchesInterests(spot, prefs);
    default:
      return spot.amenities.includes(filter);
  }
}
