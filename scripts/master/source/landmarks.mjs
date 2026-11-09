/**
 * @file 名所14か所の原データ（scripts 層・マスタ生成の入力）
 * docs/08 §9.2: 南森町周辺の実在の名所。ID・名前・座標は §9.2 のまま（check-master.mjs が照合する）。座標 at は [緯度, 経度]。
 * 南森町3・天満3・天六2・扇町3・大川3。地区は ID の地区2字（l_mm.. → d_minamimori）で決まる。名所は店舗協力の対象外（partner=false）。
 * 説明は実在の場所の一般的な紹介（40〜70字）。不確かな事実（開館時刻・休館日など）は書かず、hours は一般的な表現にとどめる。
 */

/** 名所の原データ */
export const LANDMARK_SOURCES = Object.freeze([
  // ---- 南森町・天満宮地区（門前町） ----
  {
    id: 'l_mm01', name: '大阪天満宮', at: [34.69609, 135.51277], category: '神社',
    amenities: ['toilet', 'kids', 'stroller'], hours: '境内自由',
    description: '学問の神様・菅原道真公をまつる神社。「天満の天神さん」と呼ばれて親しまれ、夏の天神祭で知られる。',
  },
  {
    id: 'l_mm02', name: '天満天神繁昌亭', at: [34.6968, 135.51225], category: '寄席',
    amenities: ['toilet', 'rainOk'], hours: '公演により異なる',
    description: '大阪天満宮の北側にある上方落語の寄席。2006年に開場した定席で、落語の公演を間近で楽しめる。',
  },
  {
    id: 'l_mm03', name: '堀川戎神社', at: [34.6997, 135.50885], category: '神社',
    amenities: ['kids'], hours: '境内自由',
    description: '「堀川のえべっさん」と親しまれる商売繁盛の神社。1月の十日戎は多くの参拝者でにぎわう。',
  },
  // ---- 天満地区（市場と食） ----
  {
    id: 'l_tm01', name: '天満市場', at: [34.70659, 135.51262], category: '市場',
    amenities: ['toilet', 'rainOk'], hours: '店舗により異なる',
    description: '生鮮食品や総菜の店が集まる市場。天神橋筋商店街のすぐそばにあり、地元の台所として親しまれている。',
  },
  {
    id: 'l_tm02', name: '天神橋筋商店街（天四）', at: [34.703, 135.5112], category: '商店街',
    amenities: ['rainOk', 'stroller', 'toilet'], hours: '店舗により異なる',
    description: '南北約2.6kmに続く、日本一長いといわれる商店街の一角。アーケードの下を雨の日でも歩いて回れる。',
  },
  {
    id: 'l_tm03', name: '天満駅前の高架下', at: [34.7049, 135.51232], category: '飲食街',
    amenities: ['rainOk'], hours: '店舗により異なる',
    description: 'JR天満駅の周りに小さな飲食店や立ち飲みが軒を連ねる一帯。夕方から夜は食べ歩きの人でにぎわう。',
  },
  // ---- 天六地区（暮らし） ----
  {
    id: 'l_tr01', name: '大阪くらしの今昔館', at: [34.71047, 135.51143], category: '博物館',
    amenities: ['toilet', 'rainOk', 'kids'], hours: '開館時間内（休館日あり）',
    description: '江戸時代の大坂の町並みを館内に実物大で再現した、住まいと暮らしの歴史を伝える博物館。',
  },
  {
    id: 'l_tr02', name: '天神橋筋商店街 北の玄関（天六）', at: [34.7111, 135.5105], category: '商店街',
    amenities: ['rainOk', 'stroller'], hours: '店舗により異なる',
    description: '天神橋筋六丁目駅のそばにある商店街の北の入口。ここから南へアーケードの食べ歩きが始まる。',
  },
  // ---- 扇町・中崎町地区（公園と路地） ----
  {
    id: 'l_og01', name: '扇町公園', at: [34.70416, 135.50915], category: '公園',
    amenities: ['kids', 'toilet', 'stroller'], hours: '終日開放',
    description: '芝生の広場や木陰のベンチがある都心の公園。散歩やひと休みに向き、休日は家族連れでにぎわう。',
  },
  {
    id: 'l_og02', name: 'キッズプラザ大阪', at: [34.70468, 135.50985], category: '博物館',
    amenities: ['kids', 'toilet', 'nursing', 'stroller', 'rainOk'], hours: '開館時間内（休館日あり）',
    description: '遊びながら学べる子どものための博物館。体験型の展示が多く、雨の日の親子のお出かけにも向く。',
  },
  {
    id: 'l_og03', name: '中崎町の路地', at: [34.7066, 135.504], category: '町並み',
    amenities: [], hours: '見学自由（店舗により異なる）',
    description: '古い長屋や町家が残る路地に、カフェや雑貨店が点在する一帯。細い道をゆっくり歩いて巡りたい。',
  },
  // ---- 大川沿い地区（川辺と桜） ----
  {
    id: 'l_ok01', name: '造幣局（桜の通り抜け）', at: [34.69519, 135.52097], category: '名所',
    amenities: ['toilet'], hours: '構内の公開は春の通り抜けの期間など',
    description: '貨幣をつくる造幣局の本局。毎年春の「桜の通り抜け」では、構内の桜並木が一般に公開される。',
  },
  {
    id: 'l_ok02', name: '泉布観', at: [34.6981, 135.52145], category: '建築',
    amenities: [], hours: '外観は見学自由（内部は公開日のみ）',
    description: '明治初期に造幣寮の応接所として建てられた洋風建築。国の重要文化財で、大川のほとりに立つ。',
  },
  {
    id: 'l_ok03', name: '南天満公園', at: [34.69197, 135.5146], category: '公園',
    amenities: ['kids', 'toilet', 'stroller'], hours: '終日開放',
    description: '大川の北岸に沿って細長く続く公園。川沿いの桜並木の下を散歩でき、春は花見の人でにぎわう。',
  },
]);
