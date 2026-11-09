/**
 * @file マスタ検証の基準値と docs/08 の固定値（scripts 層・check-master.mjs の入力）
 * 数値はすべて（仮）。アプリ側の定数（domain/exploration/constants.ts など）と同じ値を手で合わせている。
 * ここを変えるときは docs/08 §5.1・§9 と CLAUDE.md 4.1 を先に直すこと。
 * 2026-11-09: 舞台を架空の N西市から大阪・南森町周辺に変更（docs/08 §9）。地区ID・スポットID・名所の実座標・川の検証を差し替えた。
 */

/** 検証の数値基準（すべて（仮）） */
export const RULES = Object.freeze({
  /** 地区数（DI-13, SEC-22） */
  DISTRICT_COUNT: 5,
  /** 名所数（DI-13, SEC-22） */
  LANDMARK_COUNT: 14,
  /** 店舗数（DI-13, SEC-22） */
  SHOP_COUNT: 66,
  /** 地区ごとの名所数の範囲（CLAUDE.md 4.1: 2〜3か所） */
  LANDMARKS_PER_DISTRICT: Object.freeze({ min: 2, max: 3 }),
  /** 地区ごとの店舗数の範囲（CLAUDE.md 4.1: 10〜15軒） */
  SHOPS_PER_DISTRICT: Object.freeze({ min: 10, max: 15 }),
  /** スポットは地区ポリゴンの境界から何m以上内側か（仮） */
  BOUNDARY_MARGIN_M: 15,
  /** 同じ地区のスポット間の最小距離（仮） */
  MIN_SPOT_SPACING_M: 60,
  /** entrance とどのスポットとの最小距離（仮）。発見半径 80m＋余裕 */
  ENTRANCE_CLEARANCE_M: 85,
  /** 地区ポリゴンどうしの最小の隙間（通り1本ぶん。仮）。実在の街区に沿うため N西市の 60m から縮めた */
  MIN_DISTRICT_GAP_M: 15,
  /** 発見半径（仮）。domain/exploration/constants.ts DISCOVERY_RADIUS_M と同じ値 */
  DISCOVERY_RADIUS_M: 80,
  /** デモ歩行の発見判定間隔（docs/08 §6: 20m ごと。仮） */
  WALK_SAMPLE_STEP_M: 20,
  /** 開始地区の entrance→center の直線歩行で新たに発見できるスポットの最小数（仮） */
  MIN_WALK_DISCOVERIES: 2,
  /** 開始地区の entrance から和菓子店（s_mm02）までの距離範囲（仮） */
  START_ENTRANCE_TO_WAGASHI_M: Object.freeze({ min: 100, max: 160 }),
  /** 天満の「南寄り」とみなす範囲（ポリゴンの緯度幅の南から何割以内か。仮） */
  SOUTH_SIDE_RATIO: 0.5,
  /** スポットと川（kind='water' の line）の中心線との最小距離（仮）。川の中に置かないため */
  RIVER_CLEARANCE_M: 60,
  /** 背景地物・駅の座標が市域（city.bounds）の外にはみ出してよい幅（線を市域の端まで届かせるため。仮） */
  FEATURE_BOUNDS_SLACK_M: 300,
  /** 説明文の文字数（コードポイント） */
  DESCRIPTION_LENGTH: Object.freeze({ min: 40, max: 70 }),
  /** 店舗協力ありの店舗の割合（約半数。外れたら警告） */
  PARTNER_RATIO: Object.freeze({ min: 0.35, max: 0.65 }),
  /** クーポン・イベント数の目安（15件前後。外れたら警告） */
  SHOP_EVENT_COUNT: Object.freeze({ min: 10, max: 25 }),
});

/** 地区の固定値（docs/08 §9.1）。名所数・店舗数も地区ごとに固定 */
export const EXPECTED_DISTRICTS = Object.freeze([
  { id: 'd_minamimori', code: 'mm', name: '南森町・天満宮地区', shortName: '南森町', theme: '門前町', color: '#6366f1', landmarks: 3, shops: 14 },
  { id: 'd_tenma', code: 'tm', name: '天満地区', shortName: '天満', theme: '市場と食', color: '#f59e0b', landmarks: 3, shops: 15 },
  { id: 'd_tenroku', code: 'tr', name: '天六地区', shortName: '天六', theme: '暮らし', color: '#10b981', landmarks: 2, shops: 12 },
  { id: 'd_ogimachi', code: 'og', name: '扇町・中崎町地区', shortName: '扇町', theme: '公園と路地', color: '#ec4899', landmarks: 3, shops: 12 },
  { id: 'd_okawa', code: 'ok', name: '大川沿い地区', shortName: '大川', theme: '川辺と桜', color: '#0ea5e9', landmarks: 3, shops: 13 },
]);

/** 舞台の名前（districts.json の city.name） */
export const EXPECTED_CITY_NAME = '南森町周辺（大阪市北区）';

/** 舞台の原点＝南森町駅（docs/08 §9.2） */
export const EXPECTED_ORIGIN = Object.freeze({ lat: 34.6977, lng: 135.51102 });

/** 舞台の範囲（docs/08 §9.1 の市域 bounds） */
export const EXPECTED_BOUNDS = Object.freeze({ south: 34.6895, west: 135.501, north: 34.714, east: 135.5245 });

/** docs/08 §9.2 の名所14（実在。ID・名前・座標は変えない） */
export const REQUIRED_LANDMARKS = Object.freeze({
  l_mm01: { name: '大阪天満宮', lat: 34.69609, lng: 135.51277 },
  l_mm02: { name: '天満天神繁昌亭', lat: 34.6968, lng: 135.51225 },
  l_mm03: { name: '堀川戎神社', lat: 34.6997, lng: 135.50885 },
  l_tm01: { name: '天満市場', lat: 34.70659, lng: 135.51262 },
  l_tm02: { name: '天神橋筋商店街（天四）', lat: 34.703, lng: 135.5112 },
  l_tm03: { name: '天満駅前の高架下', lat: 34.7049, lng: 135.51232 },
  l_tr01: { name: '大阪くらしの今昔館', lat: 34.71047, lng: 135.51143 },
  l_tr02: { name: '天神橋筋商店街 北の玄関（天六）', lat: 34.7111, lng: 135.5105 },
  l_og01: { name: '扇町公園', lat: 34.70416, lng: 135.50915 },
  l_og02: { name: 'キッズプラザ大阪', lat: 34.70468, lng: 135.50985 },
  l_og03: { name: '中崎町の路地', lat: 34.7066, lng: 135.504 },
  l_ok01: { name: '造幣局（桜の通り抜け）', lat: 34.69519, lng: 135.52097 },
  l_ok02: { name: '泉布観', lat: 34.6981, lng: 135.52145 },
  l_ok03: { name: '南天満公園', lat: 34.69197, lng: 135.5146 },
});

/** デモシードで役割が決まっている店舗（docs/08 §9.3）の名前とカテゴリ */
export const REQUIRED_SHOPS = Object.freeze({
  s_mm01: { name: '天二珈琲店', category: '喫茶' },
  s_mm02: { name: '福まるどら焼き本舗', category: '和菓子' },
  s_mm03: { name: '天満宮前茶寮', category: '甘味処' },
  s_mm04: { name: '南森町ベーカリー', category: 'パン' },
});

/** docs/08 §9.3 の模擬ライバル（名前と地区ごとの訪問間隔） */
export const EXPECTED_RIVALS = Object.freeze({
  r_taro: { name: '旅人タロウ', intervals: { d_minamimori: 4 } },
  r_hana: { name: '旅人ハナ', intervals: { d_okawa: 3, d_minamimori: 9 } },
  r_ken: { name: '旅人ケン', intervals: { d_tenroku: 3 } },
  r_mio: { name: '旅人ミオ', intervals: { d_okawa: 6, d_ogimachi: 8 } },
  r_sora: { name: '旅人ソラ', intervals: { d_ogimachi: 3 } },
  r_riku: { name: '旅人リク', intervals: { d_minamimori: 7, d_tenroku: 9 } },
  r_aoi: { name: '旅人アオイ', intervals: { d_ogimachi: 10 } },
});

/** 背景活動を誰も持たない地区（docs/08 D9・§9.3） */
export const NO_BACKGROUND_DISTRICT = 'd_tenma';

/** 指定どおりでなければならないクーポン（実演の「期限」トリガー。docs/08 §9.3） */
export const REQUIRED_SHOP_EVENTS = Object.freeze([
  { id: 'c_mm01', spotId: 's_mm02', kind: 'coupon', title: 'どら焼き1個サービス', start: '2026-11-01', end: '2026-11-12' },
  { id: 'c_mm02', spotId: 's_mm01', kind: 'coupon', title: 'ドリンク50円引き', start: '2026-11-01', end: '2026-11-15' },
]);

/** ID を問わず存在しなければならないイベント（天四の秋の大売り出し。模擬） */
export const REQUIRED_FESTIVAL = Object.freeze({
  spotId: 'l_tm02', kind: 'event', title: '天神橋筋 秋の大売り出し（模擬）', start: '2026-10-25', end: '2026-11-30',
});

/** 期間が重なるクーポン・イベントが必要な季節の窓（冬・春） */
export const REQUIRED_SEASON_WINDOWS = Object.freeze([
  { label: '冬（2026-12〜2027-01）', start: '2026-12-01', end: '2027-01-31' },
  { label: '春（2027-03〜2027-05）', start: '2027-03-01', end: '2027-05-31' },
]);

/** 実在の名所に付けるイベントの title か description に必ず含める語（実在行事と誤認させないため） */
export const SIMULATED_MARK = '模擬';

/** 開始地区（位置リセット先。docs/08 §9.3） */
export const START_DISTRICT_ID = 'd_minamimori';

/** デモ「通い慣れた人」が開始地区で発見済みのスポット（docs/08 §9.3） */
export const DEMO_KNOWN_START_SPOTS = Object.freeze(['l_mm01', 'l_mm02', 's_mm01', 's_mm02', 's_mm03', 's_mm04']);

/** 主・金カード・取り返しの舞台になる地区（旧 本町。docs/08 §9.1） */
export const LORD_DISTRICT_ID = 'd_tenma';

/** 天満のデモシード用スポット（docs/08 §9.3。計9回訪問済み） */
export const TENMA_SEED_SPOTS = Object.freeze(['l_tm01', 'l_tm02', 's_tm01', 's_tm02', 's_tm03']);

/**
 * 天満の南寄り（南森町側）に置くシード用スポット。l_tm01 天満市場は §9.2 の実座標（34.70659）が天満の北寄りなので除く。
 * 取り返し（2スポット訪問）はこの4か所で南森町から短い距離で済む。
 */
export const TENMA_SOUTH_SPOTS = Object.freeze(['l_tm02', 's_tm01', 's_tm02', 's_tm03']);

/** 和菓子店（開始地区の entrance からの距離を検証するスポット。クーポン c_mm01） */
export const WAGASHI_SPOT_ID = 's_mm02';

/** ID の正規表現（docs/08 §2・§9・SEC-16） */
export const ID_PATTERNS = Object.freeze({
  district: /^d_[0-9a-z]{2,16}$/,
  spot: /^[ls]_[0-9a-z]{2,16}$/,
  shopEvent: /^c_[0-9a-z]{2,16}$/,
  rival: /^r_[0-9a-z]{2,16}$/,
  feature: /^f_[0-9a-z_]{2,24}$/,
  station: /^st_[0-9a-z_]{2,24}$/,
  amenityPoint: /^a_[0-9a-z_]{2,24}$/,
});

/** スポットID の命名規則（docs/08 §9.1: l|s _ 地区2字 連番2桁） */
export const SPOT_NAMING = /^([ls])_(mm|tm|tr|og|ok)(\d{2})$/;

/** 背景・便利施設ポイントの出典表示（ODbL。docs/08 §9） */
export const EXPECTED_ATTRIBUTION = '© OpenStreetMap contributors';

/** 背景地物で必ず必要な種類（川・公園・境内・敷地・商店街・道路・線路） */
export const REQUIRED_FEATURE_KINDS = Object.freeze(['water', 'park', 'shrine', 'campus', 'arcade', 'road', 'rail']);

/** docs/08 §9.2 の9駅（ID と名前） */
export const REQUIRED_STATIONS = Object.freeze({
  st_minamimori: '南森町',
  st_osakatenmangu: '大阪天満宮',
  st_ogimachi: '扇町',
  st_tenma: '天満',
  st_tenroku: '天神橋筋六丁目',
  st_tenmabashi: '天満橋',
  st_kitahama: '北浜',
  st_sakuranomiya: '桜ノ宮',
  st_nakazakicho: '中崎町',
});

/** マスタに使ってはいけない語（CLAUDE.md 11: 「施設」ではなく「スポット」） */
export const FORBIDDEN_WORDS = Object.freeze(['施設']);
