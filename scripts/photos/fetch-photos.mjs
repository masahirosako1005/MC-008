/**
 * @file 図鑑・スポット詳細の写真を Wikimedia Commons から取ってきて同梱する（開発用スクリプト。アプリには含めない）
 * 2026-11-09 ユーザー指示「リアル写真風な、場所がしっかり思い出せるデザインに」。
 * - SELECTION の Commons ファイル名ごとに、ライセンス・作者・出典を API で引き、縮小画像を public/photos/ に保存する
 * - 一覧を src/presentation/shared/spotPhotoData.ts に書き出す（アプリはこれを読む）
 * 使ってよいライセンスは CC0／パブリックドメイン／CC BY／CC BY-SA だけ（それ以外は止める）。作者とライセンスはアプリに表示する。
 * 実行: node scripts/photos/fetch-photos.mjs（ネットワークが必要。Commons の負荷に配慮して1件ずつ間をあける）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UA = 'KayoimachiDemoPhotoFetch/0.1 (internal demo build; Node fetch)';
const OK_LICENSE = /^(cc0|public domain|pd[- ]|cc[- ]by(-sa)?[- ][0-9.]+|cc by(-sa)? [0-9.]+)/i;
/** 名所は詳細の上部いっぱいに出すので大きめ、店舗のイメージは小さめ */
const WIDTH = { landmark: 960, shop: 720 };

/** 名所: スポットID → Commons のファイル名 */
const LANDMARK_SELECTION = {
  l_mm01: "File:Osaka Tenmangu Shrine 2026.jpg",
  l_mm02: "File:Temma-Tenjin Hanjo-tei in 201407.JPG",
  l_mm03: "File:Horikawa-ebisu (Osaka Kita-ku) Shrine hdsr S5 22.jpg",
  l_tm01: "File:Tenma Ichiba.jpeg",
  l_tm02: "File:Tenjinbashisuji shopping street - panoramio (19).jpg",
  l_tm03: "File:Temma-Station2.jpg",
  l_tr01: "File:Museum of Housing and Living (Osaka Kita-ku) hdsr S5 15.jpg",
  l_tr02: "File:Tenjimbashi6 on Tenjimbashisuji-Mall.JPG",
  l_og01: "File:扇町公園から見える関西テレビ Ougimachi park - panoramio.jpg",
  l_og02: "File:Kids plaza Osaka.JPG",
  l_og03: "File:Osaka Subway Nakazakicho St.jpg",
  l_ok01: "File:Cherry-Blossom-Viewing through the \"Tunnel\" at Japan Mint in 201504 015.JPG",
  l_ok02: "File:Sempukan.jpg",
  l_ok03: "File:Tenma - panoramio (14).jpg",
};

/** 店舗: カテゴリ → [保存名, Commons のファイル名] */
const CATEGORY_SELECTION = {
  喫茶: ["kissa", "File:Komeda coffee melon soda float - 2023 june 4.jpeg"],
  和菓子: ["wagashi", "File:Wisteria wagashi by Noriko Jazayeri 2025-05-18.jpg"],
  甘味処: ["kanmi", "File:Anmitsu by jetalone in Akasaka, Tokyo.jpg"],
  パン: ["bakery", "File:Bread at a Massachusetts bakery.jpg"],
  たこ焼き: ["takoyaki", "File:Takoyaki balls (1).jpg"],
  古書: ["books", "File:Bookshelf.jpg"],
  立ち飲み: ["tachinomi", "File:立ち飲み - Flickr - haru012.jpg"],
  精肉コロッケ: ["korokke", "File:Korokke.jpg"],
  呉服: ["kimono", "File:WLA vanda Black Kimono with trees.jpg"],
  うどん: ["udon", "File:Udon (Kitsune udon) 2.jpg"],
  寿司: ["sushi", "File:Nigiri Sushi (25966163204).jpg"],
  雑貨: ["zakka", "File:Monkey in Plum Blossoms by Takeuchi Seihō, c. 1910, stoneware.jpg"],
  青果: ["greengrocer", "File:Greengrocer (54762354643).jpg"],
  日本茶: ["tea", "File:2017 Kagoshima sencha - second infusion.jpg"],
  串カツ: ["kushikatsu", "File:KushikatsuDaruma01.jpg"],
  鮮魚: ["fish", "File:Fresh fish at a stall in Maizuru Port Toretore Center, Maizuru, April 2015.jpg"],
  餃子: ["gyoza", "File:Huge gyoza at Ginza Tenryu in Solamachi.jpg"],
  お好み焼き: ["okonomiyaki", "File:Okonomiyaki 001.jpg"],
  漬物: ["tsukemono", "File:Tsukemono (24068206975).jpg"],
  乾物: ["katsuobushi", "File:Katsuobushi 02.jpg"],
  食堂: ["teishoku", "File:Sakura Teishoku - Sakura Japanese Restaurant 2025-07-28.jpg"],
  焼き鳥: ["yakitori", "File:Yakitori set and others at Torihei-chan, Kamata East Exit (20230806200725).jpg"],
  台所道具: ["kitchenware", "File:Japanese kitchen knives by EverJean in Kyoto.jpg"],
  銭湯: ["sento", "File:Japanese communal bathhouse SENTO Sentō 銭湯の浴室.jpg"],
  文具: ["stationery", "File:HK SKD TKO 將軍澳 Tseung Kwan O 坑口 Hang Hau 連理街商場 The Lane mall shop 美亞公司 Meyer Stationery color pens May 2023 Px3 01.jpg"],
  豆腐: ["tofu", "File:Japanese SilkyTofu (Kinugoshi Tofu).JPG"],
  金物: ["hardware", "File:Old tools on personal workshop wall 3.jpg"],
  惣菜: ["sozai", "File:Side dishes for meals for sale at grocery store in rural Japan in 2000.jpg"],
  古着: ["vintage", "File:SZ 深圳 Shenzhen 南山區 Nanshan 深圳灣 Shenzhen Bay MixC mall shop American Vintage clothing store May 2026 N13P 02.jpg"],
  カフェ: ["cafe", "File:Latte art at Balzac's.jpg"],
  手芸: ["yarn", "File:Yarn at Folklife - Stierch.jpg"],
  ギャラリー: ["gallery", "File:Christchurch art gallery interior 002.jpg"],
  駄菓子: ["dagashi", "File:Dagashi (34865295422).jpg"],
  花: ["flowers", "File:050529 Barcelona 091.jpg"],
  おにぎり: ["onigiri", "File:Onigiri 002.jpg"],
  レンタサイクル: ["bicycle", "File:Rental bicycles at Tourism Office in Trégastel.jpg"],
  洋菓子: ["cake", "File:Japanese-style Strawberry Shortcake - 01.jpg"],
  そば: ["soba", "File:Zaru soba by spinachdip.jpg"],
  酒店: ["sake", "File:Sake bottles.jpg"],
  写真館: ["photostudio", "File:2018-Pulitzer-Prizes-photo-studio.jpg"],
  うなぎ: ["unagi", "File:Unadon of Sukiya.jpg"],
  ジェラート: ["gelato", "File:Gelato ice cream.jpg"],
  古道具: ["antiques", "File:Japan, Hokkaido, junkshop 2.jpg"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (html) => (html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/**
 * Commons API を呼ぶ（429 は待って再試行）。
 * @param {Record<string, string>} params
 */
async function api(params) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', ...params });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (res.ok) return res.json();
    await sleep(4000 * (attempt + 1));
  }
  throw new Error(`API に繋がりません: ${url}`);
}

/**
 * ファイルの情報（縮小画像の URL・ライセンス・作者・出典）を引く。
 * @param {string} title 'File:...'
 * @param {number} width 縮小幅
 */
async function infoOf(title, width) {
  const data = await api({ action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|extmetadata|mime|user', iiurlwidth: String(width) });
  const page = Object.values(data.query?.pages ?? {})[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) throw new Error(`ファイルがありません: ${title}`);
  const md = ii.extmetadata ?? {};
  const license = strip(md.LicenseShortName?.value);
  if (!OK_LICENSE.test(license)) throw new Error(`使えないライセンス: ${title} (${license})`);
  // 作者欄が空ならアップロード者（多くは撮影者本人）。Flickr 由来の「〇〇 from 地名」は名前だけにする
  const named = strip(md.Artist?.value).replace(/\s*\(talk\)\s*/i, '').replace(/ from [^,]+(,.*)?$/, '').trim();
  const artist = (named || ii.user || '不明').slice(0, 60);
  return { thumb: ii.thumburl, license, artist, sourceUrl: ii.descriptionurl };
}

/**
 * 縮小画像を保存する（429 は待って再試行）。
 * @param {string} url
 * @param {string} file public/photos からの相対
 */
async function download(url, file) {
  const dest = path.join(ROOT, 'public/photos', file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return;
    }
    await sleep(4000 * (attempt + 1));
  }
  throw new Error(`画像を取れません: ${url}`);
}

const landmarks = {};
for (const [spotId, title] of Object.entries(LANDMARK_SELECTION)) {
  const info = await infoOf(title, WIDTH.landmark);
  const file = `landmarks/${spotId}.jpg`;
  await download(info.thumb, file);
  landmarks[spotId] = { file, artist: info.artist, license: info.license, sourceUrl: info.sourceUrl };
  console.log(spotId, info.license, info.artist);
  await sleep(1500);
}
const categories = {};
for (const [category, [slug, title]] of Object.entries(CATEGORY_SELECTION)) {
  const info = await infoOf(title, WIDTH.shop);
  const file = `shops/${slug}.jpg`;
  await download(info.thumb, file);
  categories[category] = { file, artist: info.artist, license: info.license, sourceUrl: info.sourceUrl };
  console.log(category, info.license, info.artist);
  await sleep(1500);
}

const q = (s) => JSON.stringify(s);
const rows = (obj) => Object.entries(obj).map(([k, v]) => `  ${q(k)}: { file: ${q(v.file)}, artist: ${q(v.artist)}, license: ${q(v.license)}, sourceUrl: ${q(v.sourceUrl)} },`).join('\n');
const out = `/**
 * @file スポットの写真の一覧（presentation/shared 層。scripts/photos/fetch-photos.mjs が生成。手で直さない）
 * 画像は public/photos/ に同梱した Wikimedia Commons の写真の縮小版。作者・ライセンス・出典はアプリに表示する（CC BY / BY-SA の表示義務）。
 * 名所は実在の場所の写真、店舗はカテゴリのイメージ写真（店名は架空のため。画面に「イメージ」と出す）。
 */

/** 写真1枚の記録 */
export interface PhotoRecord {
  /** public/photos からの相対パス */
  readonly file: string;
  /** 作者 */
  readonly artist: string;
  /** ライセンスの略称 */
  readonly license: string;
  /** 出典（Commons のファイルページ） */
  readonly sourceUrl: string;
}

/** 名所: スポットID → 写真 */
export const LANDMARK_PHOTO_DATA: Readonly<Record<string, PhotoRecord>> = Object.freeze({
${rows(landmarks)}
});

/** 店舗: カテゴリ → イメージ写真 */
export const CATEGORY_PHOTO_DATA: Readonly<Record<string, PhotoRecord>> = Object.freeze({
${rows(categories)}
});
`;
fs.writeFileSync(path.join(ROOT, 'src/presentation/shared/spotPhotoData.ts'), out);

// 写真のクレジット一覧（同梱した写真の作者・ライセンス・出典。アプリ内では拡大プレビューとスポット詳細に出す）
const line = (key, v) => `| ${key} | ${v.file} | ${v.artist} | ${v.license} | ${v.sourceUrl} |`;
const credits = `# 写真のクレジット

図鑑とスポット詳細の写真は Wikimedia Commons から取得し、縮小・再圧縮して同梱しています（scripts/photos/fetch-photos.mjs・compress-photos.mjs）。
名所は実在の場所の写真、店舗は店名が架空のためカテゴリの「イメージ写真」です（その店の写真ではありません）。

## 名所

| スポット | ファイル | 作者 | ライセンス | 出典 |
|---|---|---|---|---|
${Object.entries(landmarks).map(([k, v]) => line(k, v)).join('\n')}

## 店舗（カテゴリのイメージ写真）

| カテゴリ | ファイル | 作者 | ライセンス | 出典 |
|---|---|---|---|---|
${Object.entries(categories).map(([k, v]) => line(k, v)).join('\n')}
`;
fs.writeFileSync(path.join(ROOT, 'public/photos/CREDITS.md'), credits);
console.log('書き出し', Object.keys(landmarks).length, Object.keys(categories).length);
