/**
 * @file public/photos の写真を縮小・再圧縮する（開発用スクリプト。fetch-photos.mjs の後に実行）
 * ブラウザのキャンバスで描き直して JPEG で保存する（撮影データ EXIF も消える＝docs/09 SEC-30 の考え方）。
 * 名所は横 800px、店舗のイメージは横 640px、画質 0.8。スマホでの読み込みを軽くする。
 * 実行: node scripts/photos/compress-photos.mjs [ブラウザの実行ファイル]（省略時は Windows の Edge）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BROWSER = process.argv[2] ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const TARGETS = [
  { dir: 'public/photos/landmarks', width: 800 },
  { dir: 'public/photos/shops', width: 640 },
];
const QUALITY = 0.8;

const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto(pathToFileURL(path.join(ROOT, 'public/photos')).href);
let before = 0;
let after = 0;
for (const { dir, width } of TARGETS) {
  for (const name of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.jpg'))) {
    const file = path.join(ROOT, dir, name);
    const src = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    const dataUrl = await page.evaluate(async ({ src, width, quality }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const w = Math.min(width, img.naturalWidth);
      const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', quality);
    }, { src, width, quality: QUALITY });
    const out = Buffer.from(dataUrl.split(',')[1], 'base64');
    before += fs.statSync(file).size;
    after += out.length;
    fs.writeFileSync(file, out);
  }
}
await browser.close();
console.log(`再圧縮: ${(before / 1024 / 1024).toFixed(1)}MB → ${(after / 1024 / 1024).toFixed(1)}MB`);
