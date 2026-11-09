/**
 * @file 店舗66軒の原データ（scripts 層・マスタ生成の入力）
 * docs/08 §9: 南森町14・天満15・天六12・扇町12・大川13。ID は s_<地区2字><連番2桁>、座標 at は [緯度, 経度]（度）。
 * 名前・説明は架空（実在の店名・チェーン名・百貨店名を使わない。実在店舗への誤認・クーポンの誤解を避けるため）。説明は40〜70字。
 * partner=true は店舗協力あり（店頭QR・クーポン）で約半数。クーポンは partner の店舗にだけ付ける（shopEvents.mjs）。
 * 配置: 南森町・天満・天六の店の多くは天神橋筋商店街（経度≒135.5112〜135.5120、北ほど西へ寄る）に 60m 以上の間隔で並べ、
 * 残りは脇道・中崎町の路地・大川沿いに置く。アーケード内の店は rainOk。川（大川・堂島川・土佐堀川）の中心線から 60m 以上離す。
 * デモ動線（docs/08 §9.3）: s_mm01 喫茶・s_mm03 甘味処は「通い慣れた人」が訪問済み、s_mm02 和菓子（クーポン c_mm01）と
 * s_mm04 パンは発見済み。s_mm05〜s_mm07 は南森町 entrance→center の道沿い（未発見）。
 * 天満の s_tm01〜s_tm03 は名所 l_tm02 とともに南寄り（南森町側）に置く（シードで訪問済み）。
 */

/** 南森町・天満宮地区（門前町）の店舗14軒 */
const MINAMIMORI_SHOPS = [
  {
    id: 's_mm01', name: '天二珈琲店', at: [34.6959, 135.51185], category: '喫茶', partner: true,
    amenities: ['toilet', 'rainOk'], hours: '8:00–18:00（水休）',
    description: '天神橋筋二丁目の昔ながらの喫茶店。ネルドリップのコーヒーと厚焼き玉子サンドで、朝から常連が集う。',
  },
  {
    id: 's_mm02', name: '福まるどら焼き本舗', at: [34.69655, 135.5116], category: '和菓子', partner: true,
    amenities: ['kids', 'stroller', 'rainOk'], hours: '9:30–19:00（木休）',
    description: 'ふっくら焼いた皮で粒あんをはさむ、どら焼きの専門店。一個から買えて、天満宮参りの手みやげに人気。',
  },
  {
    id: 's_mm03', name: '天満宮前茶寮', at: [34.6951, 135.513], category: '甘味処', partner: false,
    amenities: ['toilet', 'kids', 'rainOk'], hours: '11:00–18:00（月休）',
    description: '天満宮の表門近くの甘味処。梅の香りの白玉ぜんざいと抹茶で、参拝帰りにゆっくりひと息つける。',
  },
  {
    id: 's_mm04', name: '南森町ベーカリー', at: [34.6988, 135.51165], category: 'パン', partner: true,
    amenities: ['stroller', 'rainOk', 'kids'], hours: '7:00–19:00（日休）',
    description: '南森町駅すぐのパン屋。朝7時から焼きたてが並び、梅じゃこのおかずパンと塩パンが看板商品。',
  },
  {
    id: 's_mm05', name: 'たこ焼き くるり', at: [34.69525, 135.51195], category: 'たこ焼き', partner: true,
    amenities: ['kids', 'rainOk'], hours: '11:00–21:00（火休）',
    description: '外はカリッと中はとろりのたこ焼き屋。すだちを搾る塩味が名物で、店先で焼きたてを立ち食いできる。',
  },
  {
    id: 's_mm06', name: '梅ヶ枝古書店', at: [34.6946, 135.512], category: '古書', partner: false,
    amenities: ['rainOk'], hours: '12:00–20:00（水休）',
    description: '落語や上方文化の本がそろう古書店。店頭の百円均一の棚をのぞくのが、商店街歩きの楽しみになる。',
  },
  {
    id: 's_mm07', name: '立ち飲み ひとくち', at: [34.697, 135.51065], category: '立ち飲み', partner: false,
    amenities: [], hours: '15:00–22:00（日休）',
    description: '南森町の路地にある小さな立ち飲み。おでんと日替わりの小鉢が並び、仕事帰りの一杯に寄りやすい。',
  },
  {
    id: 's_mm08', name: '天三コロッケ精肉店', at: [34.69945, 135.5116], category: '精肉コロッケ', partner: true,
    amenities: ['kids', 'rainOk'], hours: '10:00–19:00（日休）',
    description: '揚げたてのコロッケとミンチカツが評判の精肉店。一個から買えて、食べ歩きのおやつにちょうどよい。',
  },
  {
    id: 's_mm09', name: '呉服 しらうめ', at: [34.7001, 135.51155], category: '呉服', partner: false,
    amenities: ['rainOk'], hours: '10:30–18:30（水休）',
    description: '反物から小物までそろう呉服店。手ぬぐいやがま口など気軽な和小物も多く、旅の記念に選べる。',
  },
  {
    id: 's_mm10', name: 'うどん処 ひとすじ', at: [34.70075, 135.5115], category: 'うどん', partner: true,
    amenities: ['kids', 'toilet', 'rainOk'], hours: '11:00–20:00（木休）',
    description: 'いりこと昆布のだしが香るうどん処。きざみきつねと季節のかやくご飯のセットが、昼どきの定番。',
  },
  {
    id: 's_mm11', name: '寿司 てんまる', at: [34.6988, 135.5096], category: '寿司', partner: false,
    amenities: ['toilet'], hours: '17:00–22:00（月休）',
    description: '堀川戎神社の近くの小さな寿司屋。カウンター八席で、市場から仕入れた魚を手ごろな値段で握る。',
  },
  {
    id: 's_mm12', name: '手ぬぐい雑貨 うめのか', at: [34.6968, 135.5145], category: '雑貨', partner: true,
    amenities: ['stroller', 'rainOk'], hours: '11:00–19:00（火休）',
    description: '梅や天神さんを図柄にした手ぬぐいと和雑貨の店。大阪天満宮駅から近く、季節の柄が毎月替わる。',
  },
  {
    id: 's_mm13', name: '一丁目青果店', at: [34.69395, 135.51205], category: '青果', partner: false,
    amenities: ['kids', 'rainOk'], hours: '9:00–19:00（日休）',
    description: '商店街の南の入口近くにある八百屋。季節の果物を切り売りしていて、散歩の途中に一口つまめる。',
  },
  {
    id: 's_mm14', name: '日本茶 うめかおる', at: [34.6995, 135.514], category: '日本茶', partner: true,
    amenities: ['rainOk', 'stroller'], hours: '10:00–18:00（水休）',
    description: '茶葉の量り売りと試飲ができる日本茶の店。奥の小さな喫茶で、ほうじ茶ラテと季節の和菓子を出す。',
  },
];

/** 天満地区（市場と食）の店舗15軒 */
const TENMA_SHOPS = [
  {
    id: 's_tm01', name: '串かつ ころも', at: [34.7022, 135.5115], category: '串カツ', partner: true,
    amenities: ['rainOk'], hours: '11:30–22:00（月休）',
    description: '天神橋筋の商店街にある串かつ屋。ソースの二度づけ禁止を守る昔ながらの店で、一本から気軽に頼める。',
  },
  {
    id: 's_tm02', name: '鮮魚 しおかぜ', at: [34.7024, 135.5128], category: '鮮魚', partner: true,
    amenities: ['parking'], hours: '9:00–18:00（日休）',
    description: '朝どれの魚を並べる鮮魚店。刺身の盛り合わせや焼き魚の惣菜もあり、夕方には地元の人でにぎわう。',
  },
  {
    id: 's_tm03', name: 'ひと口餃子 ぱりり', at: [34.7037, 135.5114], category: '餃子', partner: false,
    amenities: ['rainOk', 'kids'], hours: '11:30–22:00（水休）',
    description: '鉄鍋で焼くひと口餃子の店。皮はぱりっと薄く、一人前十個を分け合って食べ歩きの合間に楽しめる。',
  },
  {
    id: 's_tm04', name: '青果 みどりや', at: [34.7044, 135.51145], category: '青果', partner: true,
    amenities: ['kids', 'rainOk'], hours: '8:30–19:00（日休）',
    description: '店先に山盛りの野菜と果物が並ぶ八百屋。威勢のいい呼び込みが名物で、旬の果物は一個から買える。',
  },
  {
    id: 's_tm05', name: 'お好み焼き てんご', at: [34.7052, 135.5114], category: 'お好み焼き', partner: false,
    amenities: ['kids', 'toilet', 'rainOk'], hours: '11:00–22:00（火休）',
    description: '鉄板の前で焼き上がりを待つお好み焼き屋。山いもをたっぷり入れたふわふわの生地と、ねぎ焼きが人気。',
  },
  {
    id: 's_tm06', name: '漬物処 こうこ', at: [34.706, 135.51135], category: '漬物', partner: true,
    amenities: ['rainOk'], hours: '9:30–19:00（日休）',
    description: '樽に漬けた季節の漬物を量り売りする店。試食しながら選べ、水なすやしば漬けは手みやげにも向く。',
  },
  {
    id: 's_tm07', name: 'だしの店 かつお堂', at: [34.7068, 135.5113], category: '乾物', partner: false,
    amenities: ['rainOk'], hours: '9:00–18:00（日休）',
    description: '昆布やかつお節、干ししいたけを扱う乾物店。だしのとり方を気さくに教えてくれ、小袋でも買える。',
  },
  {
    id: 's_tm08', name: '立ち寿司 いっかん', at: [34.7076, 135.51128], category: '寿司', partner: true,
    amenities: ['rainOk'], hours: '11:00–21:00（水休）',
    description: '市場の目利きが仕入れた魚を握る立ち食い寿司。一貫から頼めて、昼どきは短い時間で手早く食べられる。',
  },
  {
    id: 's_tm09', name: '市場食堂 あさひ', at: [34.7059, 135.5138], category: '食堂', partner: false,
    amenities: ['toilet', 'kids'], hours: '7:00–15:00（日休）',
    description: '市場で働く人の朝ごはんを支えてきた食堂。焼き魚や煮物を棚から自分で選べ、朝七時から開いている。',
  },
  {
    id: 's_tm10', name: '立ち飲み さかずき', at: [34.7074, 135.513], category: '立ち飲み', partner: true,
    amenities: [], hours: '15:00–23:00（無休）',
    description: '天満らしい活気のある立ち飲み屋。どて焼きと串カツをつまみに、仕事帰りに一杯から気軽に立ち寄れる。',
  },
  {
    id: 's_tm11', name: '焼き鳥 けむり', at: [34.7051, 135.5142], category: '焼き鳥', partner: false,
    amenities: [], hours: '17:00–24:00（日休）',
    description: '高架のそばで炭火の煙を上げる焼き鳥屋。電車の音を聞きながら、塩で焼いた串を一本ずつ頼める。',
  },
  {
    id: 's_tm12', name: '精肉 ぎゅうてん', at: [34.7042, 135.5127], category: '精肉コロッケ', partner: true,
    amenities: ['kids'], hours: '10:00–19:00（日休）',
    description: '和牛を扱う町の精肉店。店頭で揚げる牛ミンチコロッケは、昼過ぎに売り切れることも多い人気の品。',
  },
  {
    id: 's_tm13', name: 'パン工房 こむぎや', at: [34.7033, 135.5148], category: 'パン', partner: false,
    amenities: ['stroller', 'kids'], hours: '7:30–18:00（月休）',
    description: '国産小麦にこだわる小さなパン工房。食パンとあんバターサンドが看板で、昼前には棚が空きはじめる。',
  },
  {
    id: 's_tm14', name: '台所道具 てまえ', at: [34.7068, 135.515], category: '台所道具', partner: true,
    amenities: ['rainOk'], hours: '10:00–18:00（日休）',
    description: '包丁や鍋、竹ざるなど台所道具の専門店。料理人も通う品ぞろえで、家庭向けの小さな道具も多い。',
  },
  {
    id: 's_tm15', name: '喫茶 ほしづき', at: [34.7045, 135.5153], category: '喫茶', partner: false,
    amenities: ['toilet', 'rainOk'], hours: '9:00–19:00（木休）',
    description: '天満の路地の奥にある喫茶店。自家製プリンと固めのホットケーキが評判で、昭和の雰囲気が残る。',
  },
];

/** 天六地区（暮らし）の店舗12軒 */
const TENROKU_SHOPS = [
  {
    id: 's_tr01', name: '古書 ほんのむし', at: [34.709, 135.51128], category: '古書', partner: false,
    amenities: ['rainOk'], hours: '12:00–20:00（火休）',
    description: '商店街の古書店。暮らしの本や料理書、昔の大阪の写真集がそろい、棚をゆっくり眺めて過ごせる。',
  },
  {
    id: 's_tr02', name: 'おはぎ処 ろくや', at: [34.7097, 135.51127], category: '和菓子', partner: true,
    amenities: ['kids', 'rainOk'], hours: '9:00–18:00（月休）',
    description: '手づくりのおはぎと季節の餅菓子の店。小ぶりで種類が多く、三つ選んで詰め合わせにする人が多い。',
  },
  {
    id: 's_tr03', name: '暮らしの道具 ひなた', at: [34.7119, 135.51072], category: '雑貨', partner: true,
    amenities: ['stroller', 'rainOk'], hours: '11:00–19:00（水休）',
    description: '器やかご、木の道具など暮らしの雑貨を集めた店。作り手の話を聞きながら、長く使えるものを選べる。',
  },
  {
    id: 's_tr04', name: '銭湯 ろくの湯', at: [34.7127, 135.5107], category: '銭湯', partner: false,
    amenities: ['toilet', 'parking'], hours: '15:00–24:00（金休）',
    description: '昔ながらの番台と富士山のペンキ絵が残る銭湯。広い湯船と薬湯があり、商店街歩きの締めにひと風呂。',
  },
  {
    id: 's_tr05', name: 'うどん ゆげ', at: [34.7106, 135.5127], category: 'うどん', partner: true,
    amenities: ['kids', 'toilet'], hours: '11:00–20:00（日休）',
    description: '天六の交差点近くのうどん屋。やわらかい麺に甘く炊いたおあげをのせた、きつねうどんが看板。',
  },
  {
    id: 's_tr06', name: '文具 ことのは', at: [34.7106, 135.5137], category: '文具', partner: false,
    amenities: ['rainOk'], hours: '10:00–19:00（日休）',
    description: '地元の学生も通う町の文具店。ノートやペンのほか、天六の町並みを描いたポストカードも置いている。',
  },
  {
    id: 's_tr07', name: 'とうふ工房 まめすけ', at: [34.7106, 135.5147], category: '豆腐', partner: true,
    amenities: ['kids'], hours: '8:00–18:00（日休）',
    description: '毎朝店の奥で豆腐を作る豆腐屋。できたての寄せ豆腐と厚揚げが並び、豆乳ソフトは子どもに人気。',
  },
  {
    id: 's_tr08', name: '八百屋 ろくちょうめ', at: [34.7095, 135.5142], category: '青果', partner: false,
    amenities: ['kids', 'parking'], hours: '9:00–19:00（日休）',
    description: '天六の台所を支える八百屋。近郊の農家から届く野菜が安く並び、夕方にはお得な詰め合わせが出る。',
  },
  {
    id: 's_tr09', name: 'パン屋 あさつゆ', at: [34.712, 135.5133], category: 'パン', partner: true,
    amenities: ['stroller', 'kids'], hours: '7:00–17:00（月休）',
    description: '住宅街の角にある小さなパン屋。毎朝焼くバゲットと、具のたっぷり入ったカレーパンが近所で評判。',
  },
  {
    id: 's_tr10', name: '珈琲 まどろみ', at: [34.7125, 135.5148], category: '喫茶', partner: false,
    amenities: ['toilet', 'rainOk'], hours: '8:00–18:00（水休）',
    description: '静かな通りの喫茶店。窓ぎわの席で厚切りトーストとコーヒーを味わえ、本を読みながら長居できる。',
  },
  {
    id: 's_tr11', name: '金物 ろっかく', at: [34.7096, 135.5096], category: '金物', partner: true,
    amenities: ['parking'], hours: '9:00–18:00（日休）',
    description: '鍋や釘、園芸用品まで並ぶ町の金物屋。困りごとを話すと合う道具を一緒に探してくれる、頼れる店。',
  },
  {
    id: 's_tr12', name: 'お惣菜 ひだまり', at: [34.7123, 135.5096], category: '惣菜', partner: false,
    amenities: ['kids', 'stroller'], hours: '10:00–20:00（日休）',
    description: '煮物やおひたしを量り売りするお惣菜の店。夕方は仕事帰りの人で混み、おにぎりも一つから買える。',
  },
];

/** 扇町・中崎町地区（公園と路地）の店舗12軒 */
const OGIMACHI_SHOPS = [
  {
    id: 's_og01', name: '喫茶 おうぎ', at: [34.7022, 135.5099], category: '喫茶', partner: true,
    amenities: ['toilet', 'kids', 'rainOk'], hours: '8:00–18:00（日休）',
    description: '扇町公園の南にある喫茶店。公園帰りの親子連れも多く、ホットケーキとミックスジュースが定番。',
  },
  {
    id: 's_og02', name: 'パン工房 こかげ', at: [34.7023, 135.5085], category: 'パン', partner: false,
    amenities: ['stroller', 'kids'], hours: '7:30–18:00（火休）',
    description: '公園でのピクニック用に買っていく人が多いパン屋。具だくさんのサンドイッチと焼き菓子がそろう。',
  },
  {
    id: 's_og03', name: '古着 ふるる', at: [34.7023, 135.507], category: '古着', partner: true,
    amenities: ['rainOk'], hours: '12:00–20:00（水休）',
    description: '扇町通り沿いの古着屋。昭和のワンピースや作業着がそろい、店主が着こなしを気さくに教えてくれる。',
  },
  {
    id: 's_og04', name: 'たこ焼き こなもん堂', at: [34.7025, 135.505], category: 'たこ焼き', partner: false,
    amenities: ['kids'], hours: '11:00–20:00（月休）',
    description: '小ぶりのたこ焼きを八個から出す店。ソースのほか塩やポン酢も選べ、公園へ持っていく人も多い。',
  },
  {
    id: 's_og05', name: '器と雑貨 しずく', at: [34.7038, 135.5038], category: '雑貨', partner: true,
    amenities: ['rainOk', 'stroller'], hours: '11:00–19:00（木休）',
    description: '作家ものの器と布小物を扱う雑貨店。町家を改装した店内は落ち着いていて、ゆっくり手に取って選べる。',
  },
  {
    id: 's_og06', name: '路地カフェ ながや', at: [34.7074, 135.503], category: 'カフェ', partner: true,
    amenities: ['rainOk', 'toilet'], hours: '11:00–20:00（火休）',
    description: '中崎町の長屋を改装したカフェ。土間の席で自家製ケーキとハンドドリップのコーヒーを楽しめる。',
  },
  {
    id: 's_og07', name: '古書と珈琲 よみさし', at: [34.7076, 135.5042], category: '古書', partner: false,
    amenities: ['rainOk'], hours: '13:00–21:00（水休）',
    description: '古本を読みながらコーヒーを飲める小さな店。気に入った本はそのまま買え、路地歩きの休憩によい。',
  },
  {
    id: 's_og08', name: '手芸 いとへん', at: [34.7072, 135.5052], category: '手芸', partner: true,
    amenities: ['rainOk'], hours: '12:00–19:00（月休）',
    description: '糸や布、ボタンなど手芸材料の店。週末にはがま口づくりなどの小さな教室を開き、旅の人も参加できる。',
  },
  {
    id: 's_og09', name: 'アトリエ きりえ', at: [34.706, 135.5029], category: 'ギャラリー', partner: false,
    amenities: ['rainOk', 'stroller'], hours: '12:00–18:00（月火休）',
    description: '切り絵作家のアトリエ兼ギャラリー。路地の町並みを描いた作品が並び、ポストカードは手ごろに買える。',
  },
  {
    id: 's_og10', name: 'ラムネ屋 しゅわり', at: [34.7064, 135.5062], category: '駄菓子', partner: true,
    amenities: ['kids', 'stroller'], hours: '11:00–18:00（水休）',
    description: '駄菓子とラムネの店。昔なつかしいくじ付きのお菓子が並び、子どもも大人も夢中になって選んでいる。',
  },
  {
    id: 's_og11', name: 'うどん こしまる', at: [34.707, 135.508], category: 'うどん', partner: false,
    amenities: ['kids', 'toilet'], hours: '11:00–15:00（日休）',
    description: '高架の近くにある昼だけのうどん屋。こしの強い麺のぶっかけが人気で、行列ができても回転は早い。',
  },
  {
    id: 's_og12', name: '花屋 はなうた', at: [34.7072, 135.5093], category: '花', partner: true,
    amenities: ['stroller'], hours: '10:00–19:00（水休）',
    description: '季節の切り花と鉢植えの店。一輪から包んでもらえ、扇町公園の木々の名前を教えてくれることもある。',
  },
];

/** 大川沿い地区（川辺と桜）の店舗13軒 */
const OKAWA_SHOPS = [
  {
    id: 's_ok01', name: '川べり珈琲 ゆらぎ', at: [34.69232, 135.5133], category: 'カフェ', partner: true,
    amenities: ['toilet', 'kids', 'stroller'], hours: '9:00–18:00（火休）',
    description: '川を望む窓辺の席があるカフェ。南天満公園の散歩の途中に寄れ、春は桜を眺めながら一服できる。',
  },
  {
    id: 's_ok02', name: 'おにぎり処 かわせみ', at: [34.69228, 135.51545], category: 'おにぎり', partner: false,
    amenities: ['kids', 'stroller'], hours: '7:00–15:00（日休）',
    description: '川沿いのおにぎり専門店。注文してから握る大きなおにぎりは、公園や川べりで食べるのにちょうどよい。',
  },
  {
    id: 's_ok03', name: '貸し自転車 かぜまち', at: [34.69225, 135.51625], category: 'レンタサイクル', partner: true,
    amenities: ['parking'], hours: '9:00–18:00（水休）',
    description: '天満橋に近い貸し自転車店。川沿いの道を走って桜の名所をめぐる、半日のコースを教えてくれる。',
  },
  {
    id: 's_ok04', name: '洋菓子 はるかぜ', at: [34.6933, 135.5172], category: '洋菓子', partner: true,
    amenities: ['kids', 'stroller', 'rainOk'], hours: '10:00–19:00（月休）',
    description: '天満橋の北にある洋菓子店。桜の塩漬けをのせたロールケーキが春の名物で、焼き菓子は日持ちもする。',
  },
  {
    id: 's_ok05', name: '手打ちそば みなも', at: [34.6941, 135.5183], category: 'そば', partner: false,
    amenities: ['toilet'], hours: '11:00–20:00（木休）',
    description: '天満橋筋の近くにある手打ちそばの店。十割そばと季節の天ぷらを、川風の抜ける座敷でゆっくり味わえる。',
  },
  {
    id: 's_ok06', name: '酒の店 おおかわ', at: [34.695, 135.5176], category: '酒店', partner: true,
    amenities: ['parking'], hours: '10:00–21:00（日休）',
    description: '大阪の地酒を多くそろえる酒店。角打ちのコーナーがあり、店主のおすすめを一杯ずつ試して選べる。',
  },
  {
    id: 's_ok07', name: '和菓子 はなみ堂', at: [34.6959, 135.5185], category: '和菓子', partner: false,
    amenities: ['kids', 'rainOk'], hours: '9:00–18:00（水休）',
    description: '桜もちや花見だんごを作る和菓子店。春の通り抜けの時期は朝早くから店を開け、季節の生菓子もある。',
  },
  {
    id: 's_ok08', name: '写真館 ひかり堂', at: [34.6968, 135.5177], category: '写真館', partner: true,
    amenities: ['rainOk'], hours: '10:00–19:00（水休）',
    description: '町の写真館。桜の季節には川沿いでの記念撮影を受け付け、古いフィルムカメラの修理相談もできる。',
  },
  {
    id: 's_ok09', name: 'うなぎ処 ながれ', at: [34.6977, 135.5188], category: 'うなぎ', partner: false,
    amenities: ['toilet'], hours: '11:30–21:00（月休）',
    description: '曽根崎通の近くのうなぎ屋。関西風に腹から開いて焼くうなぎを、香ばしいたれでじっくり焼き上げる。',
  },
  {
    id: 's_ok10', name: '茶房 はなのみち', at: [34.6986, 135.5179], category: 'カフェ', partner: true,
    amenities: ['toilet', 'kids', 'rainOk'], hours: '10:00–18:00（火休）',
    description: '川沿いの道から一本入った茶房。桜のシロップをかけたかき氷と、桜あんの最中を季節を問わず味わえる。',
  },
  {
    id: 's_ok11', name: 'ジェラート ふわり', at: [34.6995, 135.519], category: 'ジェラート', partner: false,
    amenities: ['kids', 'stroller'], hours: '11:00–19:00（水休）',
    description: '季節の果物で作るジェラートの店。川沿いを歩きながら食べられるよう、小さなカップでも出してくれる。',
  },
  {
    id: 's_ok12', name: '古道具 ゆくかわ', at: [34.7006, 135.5176], category: '古道具', partner: true,
    amenities: ['rainOk'], hours: '12:00–18:00（月火休）',
    description: '古い家具や器、昭和の看板を並べる古道具店。掘り出し物を探しに、遠くから足を運ぶ常連も多い。',
  },
  {
    id: 's_ok13', name: 'お好み焼き かわら', at: [34.7017, 135.5183], category: 'お好み焼き', partner: false,
    amenities: ['kids', 'toilet'], hours: '11:30–21:00（水休）',
    description: '源八橋に近い川沿いのお好み焼き屋。鉄板を囲む座敷があり、家族や仲間とわいわい焼いて楽しめる。',
  },
];

/** 店舗の原データ（地区の order 順に連結） */
export const SHOP_SOURCES = Object.freeze([
  ...MINAMIMORI_SHOPS,
  ...TENMA_SHOPS,
  ...TENROKU_SHOPS,
  ...OGIMACHI_SHOPS,
  ...OKAWA_SHOPS,
]);
