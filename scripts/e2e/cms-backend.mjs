#!/usr/bin/env node
/**
 * @file 連携サーバーの通し確認（ヘッドレス Edge。docs/09 §7.3）
 * 「PC の CMS で保存・掲載 → 別の端末（保存先が別）のスマホのアプリに、再読み込みなしで届く」を本物の画面で確かめる。
 * PC とスマホは別のブラウザコンテキスト（localStorage も別）にするので、届く道は連携サーバー（SSE＋公開スナップショット）だけになる。
 *
 * 使い方:
 *   1. npm run demo:backend            （別の端末で動かしたまま。http://localhost:8787）
 *   2. node scripts/e2e/cms-backend.mjs [起点URL] [出力フォルダ]
 *      既定は http://localhost:8787 と e2e-output/cms-backend。登録内容は最初に消す（デモのやり直し）。
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const BASE = process.argv[2] ?? 'http://localhost:8787';
const OUT = process.argv[3] ?? 'e2e-output/cms-backend';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SPOT = 's_mm04';
mkdirSync(OUT, { recursive: true });

const results = [];
const errors = [];
/** 結果を1行残す */
const check = (name, ok, note = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ` — ${note}` : ''}`);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
const pc = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP' });
const app = await phone.newPage();
const cms = await pc.newPage();
for (const [name, page] of [['app', app], ['cms', cms]]) {
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`${name} console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${name} ${r.status()}: ${r.url().replace(BASE, '')}`); });
}

try {
  const reset = await cms.request.post(`${BASE}/api/cms/demo/reset`, { headers: { 'content-type': 'application/json' }, data: {} });
  check('0 デモのやり直し（登録内容を消す）', reset.ok(), String(reset.status()));

  await app.goto(`${BASE}/#/spot/${SPOT}`);
  await app.waitForSelector('[data-testid="spot-detail"][data-load="ready"]', { timeout: 30000 });
  const before = await app.locator('[data-testid="spot-detail"]').innerText();
  await app.screenshot({ path: `${OUT}/1_app_before.png` });

  await cms.goto(`${BASE}/cms.html#/${SPOT}/info`);
  await cms.waitForSelector('[data-testid="cms-screen-info"]', { timeout: 30000 });
  await cms.click('[data-testid="cms-closed-6"]');
  await cms.click('[data-testid="cms-closed-0"]');
  await cms.fill('[data-testid="cms-hours-note"]', '土曜は15時まで');
  await cms.click('[data-testid="cms-amenity-nursing"]');
  await cms.click('[data-testid="cms-info-save"]');
  await cms.waitForFunction(() => /保存済み|アプリに表示中/.test(document.querySelector('[data-testid="cms-save-status"]')?.textContent ?? ''));
  check('1 CMS（PC）で営業時間・便利情報を保存', true);

  await app.waitForFunction(() => document.querySelector('[data-testid="spot-detail"]')?.textContent?.includes('土曜は15時まで'), undefined, { timeout: 15000 });
  const toast = await app.locator('text=お店の情報が更新されました').count();
  const afterInfo = await app.locator('[data-testid="spot-detail"]').innerText();
  check('2 スマホのアプリに再読み込みなしで届く（トースト・営業時間・授乳室）', toast > 0 && afterInfo.includes('授乳室') && !before.includes('土曜は15時まで'));

  await cms.click('[data-testid="cms-nav-events"]');
  await cms.waitForSelector('[data-testid="cms-screen-events"]');
  if ((await cms.locator('[data-testid="cms-event-new"]').count()) > 0) await cms.click('[data-testid="cms-event-new"]');
  await cms.waitForSelector('[data-testid="cms-event-form"]');
  await cms.click('[data-testid="cms-template"] >> nth=0');
  await cms.click('[data-testid="cms-preset-weekend"]');
  const title = await cms.inputValue('[data-testid="cms-event-title"]');
  await cms.click('[data-testid="cms-event-register"]');
  await cms.waitForSelector('text=掲載しました');
  check('3 CMS（PC）でクーポンを掲載', title.length > 0, title);
  await cms.screenshot({ path: `${OUT}/2_cms_registered.png` });

  await app.waitForFunction((t) => document.querySelector('[data-testid="spot-detail"]')?.textContent?.includes(t), title, { timeout: 15000 });
  check('4 スマホのアプリのスポット詳細にクーポンが出る', true);
  await app.screenshot({ path: `${OUT}/3_app_after.png` });

  const keys = await app.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('cms.')));
  check('5 スマホには CMS の保存データが無く、公開スナップショットの写しだけがある', keys.length === 1 && keys[0].endsWith('cms.snapshot'), keys.join(', '));
  const health = await (await cms.request.get(`${BASE}/api/health`)).json();
  check('6 SSE でつながっている（streams ≥ 1）', health.value.streams >= 1, JSON.stringify(health.value));
} catch (error) {
  check('通し確認が途中で止まった', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
} finally {
  await browser.close();
}

check('7 画面の例外・コンソールのエラーが無い', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
process.exit(results.every((r) => r.startsWith('PASS')) ? 0 : 1);
