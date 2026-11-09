/**
 * @file マスタデータ検証スクリプト（scripts 層・Node 専用）
 * public/master の生成済み JSON を読み、lib/masterChecks.mjs の全ルール（スキーマ・件数・ID・参照整合・座標配置（地区・川）・
 * デモ動線・日付・ライバル・背景・便利施設ポイント・文言）で検証する。違反が1件でもあれば一覧を表示して exit 1（docs/03 §11、DI-13, SEC-22）。
 * あわせて、改行コード（CRLF/BOM）・原データからの再生成との差分・masterHashes.ts の鮮度を警告として表示する。
 * 使い方: node scripts/master/check-master.mjs [--report]（npm run master:check）。--report で地区別一覧と主要距離も表示。
 */
import { existsSync, readFileSync } from 'node:fs';
import { renderMasterFiles } from './build-master.mjs';
import { computeMasterHashes, renderMasterHashesTs } from './hash-master.mjs';
import { checkMaster } from './lib/masterChecks.mjs';
import { printError, printLine } from './lib/cliOutput.mjs';
import { HASHES_TS_PATH, isDirectRun, loadMasterBundle } from './lib/masterFiles.mjs';
import { createCliLogger } from './lib/cliLog.mjs';

const logger = createCliLogger('scripts/master/check-master');

/**
 * ファイル本文の改行コード・BOM を検査する。ハッシュはバイト列で取るので、CRLF 化（git の autocrlf 等）で照合が崩れるため。
 * @param {Record<string, string>} texts ファイル名 → 本文
 * @returns {string[]} 警告の一覧
 */
export function checkFileEncoding(texts) {
  const log = logger.fn('checkFileEncoding', { files: Object.keys(texts).length });
  const warnings = [];
  for (const [name, text] of Object.entries(texts)) {
    if (text.startsWith('\uFEFF')) warnings.push(`[file] ${name} に BOM があります（npm run master:build で作り直す）`);
    if (text.includes('\r')) warnings.push(`[file] ${name} の改行が CRLF です（.gitattributes で eol=lf を指定し、master:build→master:hash）`);
  }
  return log.exit(warnings);
}

/**
 * public/master が原データ（scripts/master/source）から再生成した結果と一致するかを確かめる。
 * 一致しなければ JSON の手編集が疑われる（次の master:build で消える）ので警告する。
 * @param {Record<string, string>} texts ファイル名 → 本文
 * @returns {string[]} 警告の一覧
 */
export function checkRegeneration(texts) {
  const log = logger.fn('checkRegeneration', { files: Object.keys(texts).length });
  const warnings = [];
  for (const [name, expected] of renderMasterFiles()) {
    const actual = texts[name]?.replace(/\r\n/g, '\n');
    if (actual !== undefined && actual !== expected) {
      warnings.push(`[file] ${name} が原データからの生成結果と違います（手編集？ 原データを直して npm run master:build）`);
    }
  }
  return log.exit(warnings);
}

/**
 * src/infrastructure/master/masterHashes.ts が現在の public/master と一致するかを確かめる。
 * @returns {string[]} 警告の一覧（未生成・古い場合に1件）
 * @sideEffect ファイルを読む
 */
export function checkHashFreshness() {
  const log = logger.fn('checkHashFreshness');
  if (!existsSync(HASHES_TS_PATH)) return log.exit(['[hash] masterHashes.ts がまだありません（npm run master:hash）']);
  const { hashes, missing } = computeMasterHashes();
  if (missing.length > 0) return log.exit([], `missing=${missing.length}`);
  const current = readFileSync(HASHES_TS_PATH, 'utf8').replace(/\r\n/g, '\n');
  return log.exit(current === renderMasterHashesTs(hashes) ? [] : ['[hash] masterHashes.ts が古いままです（npm run master:hash）']);
}

/**
 * 距離を小数1桁のメートル表記にする。
 * @param {number} meters 距離
 * @returns {string} 例: '126.4m'
 */
function formatMeters(meters) {
  return `${meters.toFixed(1)}m`;
}

/**
 * 地区別のスポット一覧（ID と名前）を表示する。
 * @param {Record<string, any>} data パース済みマスタ
 * @returns {void}
 * @sideEffect 標準出力
 */
function printSpotList(data) {
  const log = logger.fn('printSpotList');
  const spots = [...(data['landmarks.json']?.landmarks ?? []), ...(data['shops.json']?.shops ?? [])];
  for (const d of data['districts.json']?.districts ?? []) {
    const inDistrict = spots.filter((s) => s.districtId === d.id);
    printLine(`\n■ ${d.name}（${d.id}・${d.theme}） 名所 ${inDistrict.filter((s) => s.id.startsWith('l_')).length} / 店舗 ${inDistrict.filter((s) => s.id.startsWith('s_')).length}`);
    for (const s of inDistrict) printLine(`  ${s.id} ${s.name}${s.partner ? '（協力店）' : ''}`);
  }
  log.exit(undefined);
}

/**
 * 検証時に測った主要な距離（デモ動線・地区ごとの最小間隔・地区間の隙間）を表示する。
 * @param {object} facts checkMaster の facts
 * @returns {void}
 * @sideEffect 標準出力
 */
function printFacts(facts) {
  const log = logger.fn('printFacts');
  printLine('\n■ デモ動線');
  const w = facts.startEntranceToWagashi;
  if (w) printLine(`  南森町 entrance → ${w.id} ${w.name}: ${formatMeters(w.min)}〜${formatMeters(w.max)}`);
  if (facts.walkLength) printLine(`  南森町 entrance→center の歩行距離: ${formatMeters(facts.walkLength)}`);
  for (const f of facts.walkDiscoveries ?? []) printLine(`  entrance→center の歩行で発見: ${f.id} ${f.name}（最接近 ${formatMeters(f.meters)}）`);
  for (const f of facts.tenmaSouth ?? []) printLine(`  天満南寄り: ${f.id} ${f.name}（y=${Math.round(f.y)}m、南森町 entrance から ${formatMeters(f.fromStart)}）`);
  printLine('\n■ 地区ごとの配置（最小値）');
  for (const [id, f] of Object.entries(facts.districts ?? {})) {
    const nearest = f.entranceNearest ? `entrance 最寄り ${f.entranceNearest.id} ${formatMeters(f.entranceNearest.meters)}` : '';
    printLine(`  ${id.padEnd(12)} スポット間 ${formatMeters(f.minSpacing)} / 境界から ${formatMeters(f.minMargin)} / 川から ${formatMeters(f.minRiver)} / ${nearest}`);
  }
  const a = facts.amenityCounts;
  if (a) printLine(`  背景 ${facts.features} 件・駅 ${facts.stations} 件 / 便利施設ポイント: 公衆トイレ ${a.toilet} 件・授乳室 ${a.nursing} 件`);
  printLine('\n■ 隣り合う地区の隙間');
  for (const g of facts.gaps ?? []) printLine(`  ${g.a} – ${g.b}: ${formatMeters(g.meters)}`);
  log.exit(undefined);
}

/**
 * コマンドラインの入口。読込→検証→表示を行い、終了コードを返す。
 * @param {string[]} args コマンドライン引数（--report で詳細表示）
 * @returns {number} 違反があれば 1、なければ 0
 * @sideEffect ファイル読込、標準出力・標準エラー
 */
function main(args) {
  const log = logger.fn('main', { args });
  const bundle = loadMasterBundle();
  const report = checkMaster(bundle.data);
  const errors = [...bundle.errors, ...report.errors];
  const warnings = [...checkFileEncoding(bundle.texts), ...checkRegeneration(bundle.texts), ...report.warnings, ...checkHashFreshness()];
  if (args.includes('--report')) {
    printSpotList(bundle.data);
    printFacts(report.facts);
  }
  for (const w of warnings) printLine(`WARN  ${w}`);
  for (const e of errors) printError(`ERROR ${e}`);
  printLine(`\n=== マスタ検証: error ${errors.length} / warn ${warnings.length} ===`);
  return errors.length > 0 ? log.fail(1, `errors=${errors.length}`) : log.exit(0);
}

if (isDirectRun(import.meta.url)) process.exitCode = main(process.argv.slice(2));
