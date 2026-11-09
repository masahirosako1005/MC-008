/**
 * @file 便利施設ポイント（公衆トイレ・授乳室）の原データ（scripts 層・マスタ生成の入力）
 * docs/08 §9: 公衆トイレは OpenStreetMap の amenity=toilets（Nominatim 経由で 2026-11-09 に取得、© OpenStreetMap contributors）。
 * 市域（city.bounds）内のものだけを使い、50m 以内の重複登録は1件にまとめた。川の中（水面）にあるものは無い（check-master.mjs が検証）。
 * スポットではない（図鑑・訪問の対象外）。初回の「困らない」（判断基準 A）のための情報。
 * 座標は [緯度, 経度]（度、小数6桁）。note は最寄りの公園・駅・名所（離れているものは方角と概算距離）。
 * 授乳室はキッズプラザ大阪の館内に1件だけ置く（OSM 由来ではない）。
 */

/** 便利施設ポイントの原データ（北から南の順。授乳室は末尾） */
export const AMENITY_POINT_SOURCES = Object.freeze([
  { id: 'a_wc01', kind: 'toilet', name: '公衆トイレ', at: [34.712109, 135.519632], note: '大川西岸の川沿い' },
  { id: 'a_wc02', kind: 'toilet', name: '公衆トイレ', at: [34.710847, 135.516069], note: '天神橋筋六丁目駅の東（約480m）' },
  { id: 'a_wc03', kind: 'toilet', name: '公衆トイレ', at: [34.710307, 135.511802], note: '大阪くらしの今昔館付近' },
  { id: 'a_wc04', kind: 'toilet', name: '公衆トイレ', at: [34.707641, 135.504680], note: '中崎町駅付近' },
  { id: 'a_wc05', kind: 'toilet', name: '公衆トイレ', at: [34.706901, 135.522618], note: '桜ノ宮駅の北東（約300m）' },
  { id: 'a_wc06', kind: 'toilet', name: '公衆トイレ', at: [34.705564, 135.519153], note: '桜ノ宮駅付近' },
  { id: 'a_wc07', kind: 'toilet', name: '公衆トイレ', at: [34.704707, 135.508807], note: '扇町公園内' },
  { id: 'a_wc08', kind: 'toilet', name: '公衆トイレ', at: [34.701526, 135.504104], note: '堀川戎神社の北西（約480m）' },
  { id: 'a_wc09', kind: 'toilet', name: '公衆トイレ', at: [34.701427, 135.514807], note: '天満駅の南東（約450m）' },
  { id: 'a_wc10', kind: 'toilet', name: '公衆トイレ', at: [34.700720, 135.523068], note: '毛馬桜之宮公園内（大川東岸）' },
  { id: 'a_wc11', kind: 'toilet', name: '公衆トイレ', at: [34.694809, 135.523892], note: '大川東岸（桜宮橋の南 約310m）' },
  { id: 'a_wc12', kind: 'toilet', name: '公衆トイレ', at: [34.693703, 135.521141], note: '桜之宮公園内（川崎橋付近）' },
  { id: 'a_wc13', kind: 'toilet', name: '公衆トイレ', at: [34.692745, 135.507594], note: '中之島公園内' },
  { id: 'a_wc14', kind: 'toilet', name: '公衆トイレ', at: [34.692020, 135.517689], note: '桜之宮公園内（天満橋北詰）' },
  { id: 'a_wc15', kind: 'toilet', name: '公衆トイレ', at: [34.690495, 135.514578], note: '天満橋駅の西（約190m・川の南岸）' },
  { id: 'a_wc16', kind: 'toilet', name: '公衆トイレ', at: [34.690472, 135.511525], note: '天神橋南詰付近（川の南岸）' },
  { id: 'a_nursing01', kind: 'nursing', name: '授乳室', at: [34.704680, 135.509850], note: 'キッズプラザ大阪の館内' },
]);
