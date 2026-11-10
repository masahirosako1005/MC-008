#!/usr/bin/env node
/**
 * @file 利用者アプリの正常系の通し確認（ヘッドレス Edge。`npm run e2e`）
 * デモビルドを本物のブラウザで開き、全画面の主な流れが通ることを確かめる（docs/07 §4 の動的テスト。CLAUDE.md 7.2 の実演の6手順を含む）。
 *   A 初回の人: 起動画面 → 旅人切替 → 地図（広域／中間／詳細）→ 歩いて発見 → QR でチェックイン → 購入 → スポット詳細 → アンケート
 *               → 図鑑（絞り込み・拡大）→ 記録（写真とメモ）→ 再読み込みしても残る
 *   B 通い慣れた人: 絞り込み・好み・近くのリスト・チケット → アバター → ランキング → ランク → 設定（文字・書き出し・全削除）
 *   C 実演: チェックイン → +30日で色あせ → ライバルに奪われる → 再訪で復活＋おかえりボーナス
 * 保存先はブラウザコンテキストごとに別なので、ふだん使っているブラウザのデータには触らない。
 *
 * 使い方:
 *   1. npm run build:demo && npm run preview:demo   （別の端末で動かしたまま。http://localhost:4173）
 *   2. node scripts/e2e/demo-scenario.mjs [起点URL] [出力フォルダ]
 *      既定は http://localhost:4173・e2e-output/demo-scenario。FAIL が1つでもあれば終了コード 1。
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'e2e-output/demo-scenario';
const EDGE = process.env.E2E_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
/** 思い出に付ける写真（1×1 の PNG） */
const PHOTO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
mkdirSync(OUT, { recursive: true });

const results = [];
const errors = [];
/**
 * 結果を1行残す。
 * @param {string} name 確かめたこと
 * @param {boolean} ok 通ったか
 * @param {string} [note] 補足（実際の値など）
 */
function check(name, ok, note = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ` — ${String(note).slice(0, 200)}` : ''}`);
}

/**
 * 新しい端末（保存先が別のブラウザコンテキスト）でアプリを開く。
 * @param {import('playwright-core').Browser} browser ブラウザ
 * @param {string} label ログに付ける名前
 * @param {string} [query] 起点に付けるクエリ（既定は起動画面なし）
 * @returns {Promise<import('playwright-core').Page>} 開いたページ
 */
async function openApp(browser, label, query = '?launch=0') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    // favicon の 404 は既知（アイコン未設置）。それ以外のエラーは残す
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(`[${label}] console: ${m.text().slice(0, 200)}`);
  });
  await page.goto(`${BASE}/${query}`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  return page;
}

/**
 * 画面の部品（data-testid）を指す。
 * @param {import('playwright-core').Page} page ページ
 * @param {string} id data-testid
 * @returns {import('playwright-core').Locator} ロケーター
 */
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);

/**
 * 要素の文字を1行にして返す（無ければ空文字）。
 * @param {import('playwright-core').Page} page ページ
 * @param {string} selector セレクタ
 * @returns {Promise<string>} 文字
 */
const textOf = (page, selector) => page.evaluate((s) => (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim(), selector);

/**
 * 画面を切り替える（hash を書き換えて描画を待つ）。
 * @param {import('playwright-core').Page} page ページ
 * @param {string} hash '#/zukan' など
 * @param {number} [waitMs] 待ち時間
 */
async function go(page, hash, waitMs = 1800) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(waitMs);
}

/**
 * 地図の左下の札から累計 EXP を読む（札は「EXP 600」のあとに増分の数字が続くことがあるので、台帳と同じ値を出すランク画面ではなく先頭の数だけ読む）。
 * @param {import('playwright-core').Page} page ページ
 * @returns {Promise<number>} 累計 EXP
 */
const mapExp = async (page) => Number(((await textOf(page, '[data-testid="map-exp"]')).match(/\d+/) ?? ['-1'])[0]);

/**
 * 出ている全画面の演出をスキップで閉じ、出た演出の文字を返す。
 * @param {import('playwright-core').Page} page ページ
 * @returns {Promise<string[]>} 演出の文字
 */
async function skipEffects(page) {
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const skip = tid(page, 'effect-skip').first();
    if ((await skip.count()) > 0 && (await skip.isVisible())) {
      seen.push(await textOf(page, '[data-testid="effect-layer"]'));
      await skip.click();
    }
    await page.waitForTimeout(500);
  }
  return seen;
}

/**
 * 地図のスポットへ歩いて行き、QR でチェックインする（読み上げ用の一覧のボタンを使う）。
 * @param {import('playwright-core').Page} page ページ
 * @param {string} spotId スポットID
 * @returns {Promise<{ ok: boolean, effects: string[] }>} チェックインできたか・出た演出
 */
async function walkAndCheckIn(page, spotId) {
  await page.evaluate((id) => document.querySelector(`[data-testid="map-spot"][data-spot-id="${id}"]`)?.click(), spotId);
  await page.waitForFunction(() => { const b = document.querySelector('[data-testid="spot-card-checkin"]'); return b !== null && !b.disabled; }, null, { timeout: 45000 }).catch(() => undefined);
  if (!(await tid(page, 'spot-card-checkin').isEnabled().catch(() => false))) return { ok: false, effects: [] };
  await tid(page, 'spot-card-checkin').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="qr-scan"]') !== null, null, { timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelector('[data-testid="qr-scan"]') === null, null, { timeout: 9000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
  const effects = await skipEffects(page);
  await page.waitForTimeout(2500);
  return { ok: true, effects };
}

/**
 * 地図に出ているスポット（読み上げ用の一覧）を返す。
 * @param {import('playwright-core').Page} page ページ
 * @returns {Promise<{ id: string, status: string, kind: string }[]>} スポット
 */
const mapSpots = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="map-spot"]')].map((e) => ({ id: e.dataset.spotId, status: e.dataset.status, kind: e.dataset.kind })));

/**
 * デモメニューを開いて操作し、閉じて地図へ戻る。
 * @param {import('playwright-core').Page} page ページ
 * @param {string} testId 押すボタンの data-testid
 */
async function demoAction(page, testId) {
  await go(page, '#/demo', 1000);
  await tid(page, testId).click();
  await page.waitForTimeout(900);
  await tid(page, 'demo-close').click();
  await page.waitForTimeout(2500);
}

/**
 * A 初回の人の流れ。
 * @param {import('playwright-core').Browser} browser ブラウザ
 */
async function scenarioFirstTimer(browser) {
  const page = await openApp(browser, 'A', '?launch=1');
  await page.waitForTimeout(3500);
  check('A1 起動画面が出る', (await tid(page, 'launch').count()) === 1);
  await tid(page, 'launch-start').click({ timeout: 8000 }).catch(() => page.mouse.click(195, 400));
  await page.waitForTimeout(1500);
  check('A2 スタートで地図へ', (await tid(page, 'launch').count()) === 0 && page.url().includes('#/map'), page.url());
  // 歯車の長押し → デモメニュー → 初回の人
  const gear = await tid(page, 'gear').boundingBox();
  await page.mouse.move(gear.x + gear.width / 2, gear.y + gear.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  await page.waitForTimeout(800);
  check('A3 歯車の長押しでデモメニュー', page.url().includes('#/demo'), page.url());
  if (!page.url().includes('#/demo')) await go(page, '#/demo');
  await page.getByRole('button', { name: '初回の人' }).click();
  await page.waitForTimeout(1200);
  await tid(page, 'demo-close').click();
  await page.waitForTimeout(2500);
  check('A4 初回の人に切り替わり EXP 0', (await textOf(page, '[data-testid="status-profile"]')).includes('初回の人') && (await mapExp(page)) === 0);
  check('A5 切り替えた直後の地図に、前の人の街の「奪われた／にぎわい」が出ない', !/にぎわい|奪われた/.test(await textOf(page, '[data-testid="map-area"]')));
  for (const zoom of ['広域', '中間', '詳細']) {
    await page.getByRole('button', { name: zoom, exact: true }).click();
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: join(OUT, 'A_map.png') });
  const shop = (await mapSpots(page)).find((s) => s.kind === 'shop');
  check('A6 詳細の地図にお店が出る', shop !== undefined);
  if (shop === undefined) return;
  const visit = await walkAndCheckIn(page, shop.id);
  const exp1 = await mapExp(page);
  check('A7 歩いて着き、QR でチェックインして EXP が増える', visit.ok && exp1 > 0, `EXP ${exp1}`);
  check('A8 地図のスポットが達成済みになる', (await mapSpots(page)).find((s) => s.id === shop.id)?.status === 'visited');
  // 購入 QR
  await page.evaluate((id) => document.querySelector(`[data-testid="map-spot"][data-spot-id="${id}"]`)?.click(), shop.id);
  await page.waitForTimeout(2500);
  await tid(page, 'spot-card-purchase').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="qr-scan"]') === null, null, { timeout: 9000 }).catch(() => undefined);
  await page.waitForTimeout(4500);
  check('A9 購入 QR で EXP が増える', (await mapExp(page)) > exp1, `EXP ${exp1} → ${await mapExp(page)}`);
  // スポット詳細・アンケート
  await tid(page, 'spot-card-detail').click();
  await page.waitForTimeout(1800);
  check('A10 スポット詳細に通った回数 1回', page.url().includes(`#/spot/${shop.id}`) && /1回/.test(await textOf(page, '[data-testid="spot-visit-count"]')));
  await tid(page, 'survey-open').click();
  await page.waitForTimeout(600);
  await tid(page, 'survey-level-4').click();
  await tid(page, 'survey-trigger-app').click();
  await tid(page, 'survey-good-quality').click();
  await page.locator('[data-testid^="survey-revisit"]').first().click();
  await tid(page, 'survey-comment').fill('また来ます');
  await tid(page, 'survey-send').click();
  await page.waitForTimeout(1200);
  check('A11 アンケートを送ると「回答済み」になる', (await tid(page, 'survey-form').count()) === 0 && (await tid(page, 'survey-open').isDisabled()));
  // 図鑑
  await go(page, '#/zukan');
  await tid(page, 'zukan-filter-status').selectOption({ label: '達成済み' });
  await page.waitForTimeout(600);
  check('A12 図鑑の「達成済み」で1枚', (await tid(page, 'zukan-tile').count()) === 1);
  await tid(page, 'zukan-tile').first().click();
  await page.waitForTimeout(700);
  check('A13 カードの拡大プレビュー', (await tid(page, 'zukan-card-preview').count()) === 1);
  await page.getByRole('button', { name: /スポット詳細へ/ }).click();
  await page.waitForTimeout(1500);
  check('A14 プレビューからスポット詳細へ', page.url().includes(`#/spot/${shop.id}`), page.url());
  // 記録（写真とメモ）
  await go(page, '#/zukan');
  await tid(page, 'zukan-mode-log').click();
  await page.waitForTimeout(800);
  check('A15 記録に1件', (await tid(page, 'log-entry').count()) === 1);
  await tid(page, 'log-entry').first().click();
  await page.waitForTimeout(700);
  await tid(page, 'memory-photo-input').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PHOTO_PNG });
  await page.waitForTimeout(1500);
  await tid(page, 'memory-note').fill('はじめての一軒');
  await tid(page, 'memory-save').click();
  await page.waitForTimeout(1200);
  // 読み込み直す（?launch=1 のままだと起動画面がまた出るので、起動画面なしで開き直す）
  await page.goto(`${BASE}/?launch=0#/zukan`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await tid(page, 'zukan-mode-log').click();
  await page.waitForTimeout(800);
  const entry = await page.evaluate(() => { const e = document.querySelector('[data-testid="log-entry"]'); return e === null ? null : { images: e.querySelectorAll('img').length, text: e.textContent ?? '' }; });
  check('A16 再読み込みしても訪問・写真・メモが残る', entry !== null && entry.images === 1 && entry.text.includes('はじめての一軒'));
  await page.screenshot({ path: join(OUT, 'A_log.png') });
  await page.context().close();
}

/**
 * B 通い慣れた人の流れ（地図の部品と各タブ・設定）。
 * @param {import('playwright-core').Browser} browser ブラウザ
 */
async function scenarioRegular(browser) {
  const page = await openApp(browser, 'B');
  check('B1 通い慣れた人の地図（EXP 600）', (await mapExp(page)) === 600, `EXP ${await mapExp(page)}`);
  // 絞り込み・好み
  await page.getByRole('button', { name: '中間', exact: true }).click();
  await page.waitForTimeout(1000);
  const pressed = [];
  for (const chip of await tid(page, 'map-filter').all()) {
    await chip.click();
    await page.waitForTimeout(400);
    pressed.push(await chip.getAttribute('aria-pressed'));
    await chip.click();
  }
  check('B2 便利情報の絞り込みを入り切りできる', pressed.length >= 5 && pressed.every((p) => p === 'true'), pressed.join(','));
  await tid(page, 'map-prefs-open').click();
  await page.waitForTimeout(600);
  await tid(page, 'map-prefs-interest').first().click();
  await tid(page, 'map-prefs-save').click();
  await page.waitForTimeout(600);
  check('B3 好みを保存して閉じる', (await tid(page, 'map-prefs-panel').count()) === 0);
  // 近くのリスト
  await tid(page, 'map-nearby-open').click();
  await page.waitForTimeout(700);
  await page.locator('.map-nearby__tab', { hasText: 'クエスト' }).click();
  await page.waitForTimeout(600);
  const kinds = await page.evaluate(() => [...document.querySelectorAll('[data-testid="reason-card"]')].map((e) => e.dataset.kind));
  check('B4 クエスト（再訪理由）に期限・色あせ・未達成が出る', ['deadline', 'fade', 'unvisited'].every((k) => kinds.includes(k)), kinds.join(','));
  await page.locator('.map-nearby__tab', { hasText: '地区' }).click();
  await page.waitForTimeout(600);
  check('B5 地区カードが5枚', (await tid(page, 'district-card').count()) === 5);
  // 期限のクエスト → お店へ歩く → チケットを使う（お店から80m以内）
  await page.locator('.map-nearby__tab', { hasText: 'クエスト' }).click();
  await page.waitForTimeout(500);
  const deadline = page.locator('[data-testid="reason-card"][data-kind="deadline"]').last();
  await deadline.click();
  await page.waitForFunction(() => { const b = document.querySelector('[data-testid="spot-card-checkin"]'); return b !== null && !b.disabled; }, null, { timeout: 60000 }).catch(() => undefined);
  // お店の名前は、着いた先のお店カードから読む（クエストのカードの題は店名だけ・期限つきなど書き方が変わるため）
  const shopName = await textOf(page, '[data-testid="spot-card"] .map-spot-card__name');
  check('B6 期限のクエストからお店へ歩いて着く', await tid(page, 'spot-card-checkin').isEnabled().catch(() => false), shopName);
  await tid(page, 'spot-card-close').click();
  await page.waitForTimeout(400);
  await tid(page, 'ticket-button').click();
  await page.waitForTimeout(700);
  await page.locator('[data-testid="ticket-item"]', { hasText: shopName }).first().click();
  await page.waitForTimeout(600);
  check('B7 チケットの QR とコードが出る', (await tid(page, 'ticket-qr').count()) === 1 && (await textOf(page, '[data-testid="ticket-code"]')).length > 3);
  await tid(page, 'ticket-use').click();
  await page.waitForTimeout(300);
  await tid(page, 'ticket-use-confirm').click();
  await page.waitForTimeout(900);
  check('B8 お店でチケットを使用済みにできる', (await tid(page, 'ticket-qr').getAttribute('data-status')) === 'used');
  await page.screenshot({ path: join(OUT, 'B_ticket.png') });
  // アバター
  await go(page, '#/avatar', 2200);
  await page.locator('.avatar-tab', { hasText: /^髪型$/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /ロング（ノーマル）/ }).click();
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.locator('.avatar-tab', { hasText: /^髪型$/ }).click();
  await page.waitForTimeout(400);
  check('B9 アバターの着替えが再読み込み後も残る', (await page.getByRole('button', { name: /ロング（ノーマル）身につけています/ }).count()) === 1);
  const photo = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.getByRole('button', { name: '撮影', exact: true }).click();
  check('B10 記念撮影の PNG を保存できる', (await photo) !== null);
  // ランキング・ランク
  await go(page, '#/ranking', 2200);
  for (const league of ['かよい', 'はじめまして', 'ルーキー']) {
    await page.locator('.league-seg__item', { hasText: league }).click();
    await page.waitForTimeout(900);
  }
  await page.locator('.league-seg__item', { hasText: 'かよい' }).click();
  await page.waitForTimeout(800);
  check('B11 ランキング: 表彰台と領主5地区', (await tid(page, 'podium').count()) >= 1 && (await tid(page, 'ranking-lord-card').count()) === 5);
  await go(page, '#/rank', 3000);
  check('B12 ランク: 街の英雄・600 EXP・NEXT', /街の英雄/.test(await textOf(page, '[data-testid="rank-name"]')) && /600/.test(await textOf(page, '[data-testid="rank-points"]')) && /あと/.test(await textOf(page, '[data-testid="rank-next"]')));
  await page.screenshot({ path: join(OUT, 'B_rank.png') });
  // 設定
  await tid(page, 'gear').click();
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  await tid(page, 'text-scale-xlarge').click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  check('B13 設定: 文字の大きさが変わる', page.url().includes('#/settings') && before !== after, `${before} → ${after}`);
  await tid(page, 'text-scale-normal').click();
  const exported = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await tid(page, 'settings-export').click();
  const file = await exported;
  let entries = 0;
  if (file !== null) {
    const path = join(OUT, 'export.json');
    await file.saveAs(path);
    entries = Object.keys(JSON.parse(readFileSync(path, 'utf8')).entries ?? {}).length;
  }
  check('B14 設定: データを書き出せる（JSON）', file !== null && entries > 0, `${entries} 件`);
  // 書き出した後に設定を変え、書き出したファイルを読み込むと元に戻る（DI-21 復元）
  await tid(page, 'text-scale-xlarge').click();
  await page.waitForTimeout(500);
  const changed = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  await tid(page, 'settings-import-file').setInputFiles(join(OUT, 'export.json'));
  await page.waitForTimeout(600);
  await tid(page, 'settings-import-ok').click();
  await page.waitForTimeout(3500);
  const restored = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  check('B14b 設定: 書き出したファイルを読み込むと元に戻る', page.url().includes('#/map') && changed !== before && restored === before && (await mapExp(page)) === 600, `${changed} → ${restored} EXP ${await mapExp(page)}`);
  // 合わないファイルは断り、データはそのまま
  await tid(page, 'gear').click();
  await page.waitForTimeout(1200);
  await tid(page, 'settings-import-file').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"other","entries":{"session":{}}}') });
  await page.waitForTimeout(600);
  await tid(page, 'settings-import-ok').click();
  await page.waitForTimeout(600);
  const refused = (await tid(page, 'toast').allInnerTexts()).join(' ');
  check('B14c 設定: 合わないファイルは読み込まない', page.url().includes('#/settings') && refused.includes('読み込めません'), refused);
  await tid(page, 'settings-delete').click();
  await page.waitForTimeout(600);
  await tid(page, 'settings-delete-ok').click();
  await page.waitForTimeout(3500);
  check('B15 設定: 全削除のあと、最初の状態で地図が開く', page.url().includes('#/map') && (await mapExp(page)) === 600, `${page.url()} EXP ${await mapExp(page)}`);
  await page.context().close();
}

/**
 * C 発表の実演（CLAUDE.md 7.2 の手順 3〜6）。
 * @param {import('playwright-core').Browser} browser ブラウザ
 */
async function scenarioDemo(browser) {
  const page = await openApp(browser, 'C');
  await page.getByRole('button', { name: '詳細', exact: true }).click();
  await page.waitForTimeout(1500);
  const shop = (await mapSpots(page)).find((s) => s.kind === 'shop');
  if (shop === undefined) return check('C1 詳細の地図にお店が出る', false);
  const exp0 = await mapExp(page);
  const first = await walkAndCheckIn(page, shop.id);
  const exp1 = await mapExp(page);
  check('C1 チェックインで EXP が増える', first.ok && exp1 > exp0, `EXP ${exp0} → ${exp1}`);
  await demoAction(page, 'demo-advance-30');
  await tid(page, 'map-nearby-open').click();
  await page.waitForTimeout(700);
  await page.locator('.map-nearby__tab', { hasText: 'クエスト' }).click();
  await page.waitForTimeout(600);
  const fadeCount = await page.locator('[data-testid="reason-card"][data-kind="fade"]').count();
  check('C2 +30日で色あせのクエストが出る', /\+30日/.test(await textOf(page, '[data-testid="status-date"]')) && fadeCount > 0, `${fadeCount} 件`);
  await tid(page, 'map-nearby-close').click();
  await demoAction(page, 'demo-rival');
  await skipEffects(page);
  await tid(page, 'map-nearby-open').click();
  await page.waitForTimeout(700);
  await page.locator('.map-nearby__tab', { hasText: 'クエスト' }).click();
  await page.waitForTimeout(600);
  check('C3 ライバルに奪われると「奪還」のクエストが出る', (await page.locator('[data-testid="reason-card"][data-kind="reclaim"]').count()) > 0);
  await tid(page, 'map-nearby-close').click();
  await page.getByRole('button', { name: '詳細', exact: true }).click();
  await page.waitForTimeout(1500);
  const again = await walkAndCheckIn(page, shop.id);
  const exp2 = await mapExp(page);
  check('C4 再訪で「おかえり」の復活演出が出る', again.effects.some((e) => /おかえり/.test(e)), again.effects.join(' | '));
  check('C5 おかえりボーナスで獲得 EXP が 1.5 倍', exp2 - exp1 >= 22, `EXP ${exp1} → ${exp2}`);
  await demoAction(page, 'demo-advance-90');
  check('C6 +90日たっても EXP は減らない', (await mapExp(page)) === exp2, `EXP ${await mapExp(page)}`);
  await page.screenshot({ path: join(OUT, 'C_after.png') });
  await page.context().close();
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
try {
  for (const scenario of [scenarioFirstTimer, scenarioRegular, scenarioDemo]) {
    try {
      await scenario(browser);
    } catch (error) {
      check(`${scenario.name} が途中で止まった`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
    }
  }
} finally {
  await browser.close();
}
check('Z ブラウザのエラー（pageerror・console.error）が無い', errors.length === 0, [...new Set(errors)].slice(0, 5).join(' / '));
console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n=== 正常系の通し確認: ${results.length - failed} PASS / ${failed} FAIL（${BASE}） ===`);
process.exit(failed === 0 ? 0 : 1);
