/**
 * @file 模擬ライバル7人の原データ（scripts 層・マスタ生成の入力）
 * docs/08 D9 / §9.3: 各ライバルは地区ごとに「intervalDays 日ごとに1回訪問」の背景活動を持つ。
 * 訪問日は (epochDay(d) + phase) % intervalDays === 0 で決まる（phase は 0..intervalDays-1）。
 * 天満地区（d_tenma）の背景活動は誰も持たない（デモ手順5の「ライバル行動」で主交代を確実に起こすため）。
 * 2026-11-09: 舞台変更で地区IDだけ差し替えた（城下→南森町、みなと→大川、里山→天六、湯の里→扇町。間隔と phase は同じ）。
 */

/** ライバルの原データ。build-master.mjs がそのまま public/master/rivals.json に書く */
export const RIVAL_SOURCES = Object.freeze([
  { id: 'r_taro', name: 'おまいり番長', patterns: [{ districtId: 'd_minamimori', intervalDays: 4, phase: 1 }] },
  {
    id: 'r_hana', name: '花見は毎日派',
    patterns: [
      { districtId: 'd_okawa', intervalDays: 3, phase: 0 },
      { districtId: 'd_minamimori', intervalDays: 9, phase: 4 },
    ],
  },
  { id: 'r_ken', name: '天六の生き字引', patterns: [{ districtId: 'd_tenroku', intervalDays: 3, phase: 2 }] },
  {
    id: 'r_mio', name: 'みおつくし',
    patterns: [
      { districtId: 'd_okawa', intervalDays: 6, phase: 3 },
      { districtId: 'd_ogimachi', intervalDays: 8, phase: 5 },
    ],
  },
  { id: 'r_sora', name: '中崎町カフェ部', patterns: [{ districtId: 'd_ogimachi', intervalDays: 3, phase: 1 }] },
  {
    id: 'r_riku', name: '商店街踏破中',
    patterns: [
      { districtId: 'd_minamimori', intervalDays: 7, phase: 2 },
      { districtId: 'd_tenroku', intervalDays: 9, phase: 6 },
    ],
  },
  { id: 'r_aoi', name: '親子でてくてく', patterns: [{ districtId: 'd_ogimachi', intervalDays: 10, phase: 7 }] },
]);
