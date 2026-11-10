#!/usr/bin/env node
/**
 * @file 静的監査スクリプト（依存ライブラリなし / Node 18+）
 * 使い方: node scripts/audit/static-audit.mjs [対象ディレクトリ...] [--json] [--warn-only]
 * 既定の対象: src/
 * 仕様: docs/07_audit_procedure.md §2
 * 除外: 行末に `// audit-ignore: <check> <理由>` を書くとその行のそのチェックを除外（理由必須）
 * 対象が src 全体のときは、プロジェクト全体の検査（orphan-file / unused-export / long-file）も行う。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const warnOnly = args.includes('--warn-only');
const targets = args.filter((a) => !a.startsWith('--'));
if (targets.length === 0) targets.push('src');

const ROOT = process.cwd();
const findings = [];

/** 層の判定（パス → 層名）。src/ 直下のフォルダ名で決める */
function layerOf(relPath) {
  const p = relPath.split(sep).join('/');
  const m = p.match(/(?:^|\/)(presentation|application|domain|infrastructure|Common)\//);
  return m ? m[1] : null;
}

/** 許可される依存（docs/01_architecture.md §1.1） */
const ALLOWED = {
  presentation: new Set(['presentation', 'application', 'domain', 'Common']),
  application: new Set(['application', 'domain', 'Common']),
  domain: new Set(['domain', 'Common']),
  infrastructure: new Set(['infrastructure', 'domain', 'application', 'Common']),
  Common: new Set(['Common']),
};

/** 検査対象ファイルを再帰列挙 */
function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'coverage'].includes(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full));
    else if (/\.(ts|tsx|js|mjs|jsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * CSS ファイルを再帰列挙（色の直書きの検査 color-literal 用）。
 * @param {string} dir 起点
 * @returns {string[]} CSS ファイルのパス
 */
function listCssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'coverage'].includes(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listCssFiles(full));
    else if (/\.css$/.test(name)) out.push(full);
  }
  return out;
}

/** 色の値を置いてよい CSS（docs/10_color_system.md §3）: トークン本体と、トークンより先に読む起動スプラッシュ */
const COLOR_SOURCE_FILES = ['src/Common/ui/styles/tokens.css', 'src/presentation/screens/Launch/splash.css'];
/** CSS で直書きしてよい色: 白・黒・--ink（42,33,27）とその透過 */
const ALLOWED_COLOR = /^(#fff|#ffffff|#000|#000000|rgba?\((255,255,255|0,0,0|42,33,27)(,[0-9.]+)?\))$/i;

/**
 * CSS の色の直書きを検査する（color-literal。docs/10_color_system.md）。トークン（var(--…)）以外の色を warn で知らせる。
 * 行に「audit-ignore: color-literal 理由」があれば対象外。
 * @param {string} file CSS ファイル
 * @sideEffect findings に追加する
 */
function auditCss(file) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (COLOR_SOURCE_FILES.includes(rel)) return;
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/audit-ignore:\s*color-literal\s+\S/.test(line)) return;
    if (/\{\s*$/.test(line.trim()) && !line.includes(':')) return;
    const found = (line.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? []).map((c) => c.replace(/\s+/g, '')).filter((c) => !ALLOWED_COLOR.test(c));
    if (found.length > 0) report('color-literal', 'warn', file, i + 1, `色の直書き ${[...new Set(found)].slice(0, 3).join(' ')}。tokens.css の名前を使う（docs/10）`);
  });
}

/** 行に該当チェックの audit-ignore があるか（理由必須） */
function ignored(line, check) {
  const m = line.match(/\/\/\s*audit-ignore:\s*([\w-]+)\s+(\S.*)$/);
  return !!m && m[1] === check;
}

function report(check, level, file, lineNo, message) {
  findings.push({ check, level, file: relative(ROOT, file).split(sep).join('/'), line: lineNo, message });
}

/** 関数定義の開始行を検出（function 宣言 / export const アロー / クラスメソッド） */
const FN_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/,
  /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
  /^\s*(?:(?:public|private|protected|static|readonly|override)\s+)*(?:async\s+)?(?!if\b|for\b|while\b|switch\b|catch\b|return\b|new\b|function\b|constructor\b)([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
];
const NOT_FN_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'constructor', 'super', 'else']);

/** 直前の非空行が JSDoc の終端か（デコレータ行は読み飛ばす） */
function hasJsDocBefore(lines, idx) {
  let i = idx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return false;
  if (lines[i].trim().endsWith('*/')) return true;
  if (/^\s*@/.test(lines[i])) return hasJsDocBefore(lines, i);
  return false;
}

/** 関数本体の終了行（波括弧の対応で推定。式本体のアローは開始行） */
function functionBodyEnd(lines, start) {
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; seen = true; }
      else if (ch === '}') depth--;
    }
    if (seen && depth <= 0) return i;
    if (!seen && i > start + 2) return start;
  }
  return lines.length - 1;
}

/** 1 ファイルを監査 */
function auditFile(file) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const src = readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const layer = layerOf(rel);
  const isTest = /\.test\.(ts|tsx|js)$/.test(rel) || rel.includes('/__tests__/');
  const isLogging = rel.includes('/Common/logging/') || rel.endsWith('docs/templates/logger.ts');
  const isTimeImpl = rel.includes('/infrastructure/time/') || rel.includes('/Common/utils/');
  const isRandomImpl = rel.includes('/infrastructure/random/');
  const isConstants = /\/constants\.ts$/.test(rel);

  if (!isTest && !/^\s*\/\*\*[\s\S]{0,400}?@file/.test(src)) {
    report('file-header-missing', 'warn', file, 1, 'ファイル先頭に @file コメントがありません（CM-03）');
  }

  lines.forEach((line, i) => {
    const n = i + 1;
    const code = line.replace(/\/\/(?!\s*audit-ignore).*$/, '');

    // dependency-rule（01 §1.1）
    const im = line.match(/from\s+['"]([^'"]+)['"]/) || line.match(/import\s*\(\s*['"]([^'"]+)['"]/);
    if (im && layer && !ignored(line, 'dependency-rule')) {
      const spec = im[1];
      let target = null;
      const alias = spec.match(/^@\/(presentation|application|domain|infrastructure|Common)\//);
      if (alias) target = alias[1];
      else if (spec.startsWith('.')) {
        const relm = spec.match(/\/(presentation|application|domain|infrastructure|Common)\//);
        target = relm ? relm[1] : layer;
      }
      if (target && !ALLOWED[layer].has(target)) {
        report('dependency-rule', 'error', file, n, `${layer} → ${target} の依存は禁止 (${spec})`);
      }
      if (layer === 'domain' && /^(node:|fs$|path$|http|react|vue|@vue|svelte|solid-js)/.test(spec)) {
        report('dependency-rule', 'error', file, n, `domain 層が外部モジュールに依存 (${spec})`);
      }
    }

    // console-direct（LG-01）
    if (!isLogging && /\bconsole\.(log|info|warn|error|debug|trace|table)\s*\(/.test(code) && !ignored(line, 'console-direct')) {
      report('console-direct', 'error', file, n, 'console.* の直書き。Common/logging を使う（LG-01）');
    }

    // innerhtml / eval（SEC-14, SEC-23）
    if (/\.(innerHTML|outerHTML)\s*\+?=|insertAdjacentHTML\s*\(|document\.write\s*\(|dangerouslySetInnerHTML/.test(code) && !ignored(line, 'innerhtml')) {
      report('innerhtml', 'error', file, n, 'HTML 文字列の直接挿入（XSS）。textContent / DOM API を使う（SEC-14）');
    }
    if (/\beval\s*\(|new\s+Function\s*\(/.test(code) && !ignored(line, 'eval')) {
      report('eval', 'error', file, n, 'eval / new Function は禁止（SEC-23）');
    }

    // date-now / math-random（DI-03, SEC-12）
    if (!isTimeImpl && !isTest && /\bDate\.now\s*\(|new\s+Date\s*\(/.test(code) && !ignored(line, 'date-now')) {
      const level = layer === 'domain' || layer === 'application' ? 'error' : 'warn';
      report('date-now', level, file, n, '現在時刻は Clock ポート経由で取得する（DI-03）');
    }
    if (!isRandomImpl && !isTest && /\bMath\.random\s*\(/.test(code) && !ignored(line, 'math-random')) {
      report('math-random', 'warn', file, n, '乱数は RandomSource ポート経由。ID/トークンには crypto を使う（SEC-12）');
    }

    // secret-pattern（SEC-11）
    if (/(?:api[_-]?key|secret|password|passwd|token|authorization)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(code) && !ignored(line, 'secret-pattern')) {
      report('secret-pattern', 'error', file, n, '秘密情報らしきリテラル（SEC-11）');
    }
    if (/(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/.test(code) && !ignored(line, 'secret-pattern')) {
      report('secret-pattern', 'error', file, n, 'トークン形式の文字列（SEC-11）');
    }

    // any-type（03 §1）
    if (!isTest && /:\s*any\b|as\s+any\b|<any>/.test(code) && !ignored(line, 'any-type')) {
      report('any-type', 'warn', file, n, 'any の使用（03 §1）');
    }

    // todo-stale（04 §1.4）
    if (/\/\/\s*(TODO|FIXME)\b(?!\()/.test(line) && !ignored(line, 'todo-stale')) {
      report('todo-stale', 'warn', file, n, 'TODO/FIXME に担当・条件がありません（例: TODO(AI): 内容 期限）');
    }

    // magic-radius（01 §3-9）: 80/40 のリテラルが距離文脈で constants.ts 以外にある
    if (!isConstants && !isTest && layer && /(^|[^\w.])(80|40)(?![\w.])/.test(code) && /(radius|meter|distance|dist\b|半径|距離|m\b)/i.test(line) && !ignored(line, 'magic-radius')) {
      report('magic-radius', 'warn', file, n, '80/40 のリテラル。DISCOVERY_RADIUS_M / VISIT_RADIUS_M を使う');
    }

    // 関数検出 → jsdoc-missing / fnlog-missing / long-function
    for (const re of FN_PATTERNS) {
      const m = code.match(re);
      if (!m) continue;
      const name = m[1];
      if (!name || NOT_FN_NAMES.has(name)) break;
      if (!isTest && !hasJsDocBefore(lines, i) && !ignored(line, 'jsdoc-missing')) {
        report('jsdoc-missing', 'error', file, n, `関数 ${name} に日本語 JSDoc がありません（CM-01）`);
      }
      const end = functionBodyEnd(lines, i);
      const bodyLen = end - i + 1;
      if (bodyLen > 50 && !ignored(line, 'long-function')) {
        report('long-function', 'warn', file, n, `関数 ${name} が ${bodyLen} 行（上限 50）`);
      }
      if (!isTest && !isLogging && bodyLen > 3) {
        const body = lines.slice(i, end + 1).join('\n');
        if (!/\.fn\s*\(\s*['"`]/.test(body) && !ignored(line, 'fnlog-missing')) {
          report('fnlog-missing', 'warn', file, n, `関数 ${name} に logger.fn() がありません（LG-02）`);
        }
      }
      break;
    }
  });
}

// ---------------------------------------------------------------------------
// プロジェクト全体の検査（保守性）: orphan-file / unused-export / long-file
// 1ファイルだけでは分からない「どこからも使われていない」を見るので、対象が src 全体のときだけ動かす。
// ---------------------------------------------------------------------------

/** 入口（ほかのファイルから import されない前提のファイル） */
const ENTRY_FILES = new Set(['src/main.ts', 'src/cmsMain.ts', 'src/serverMain.ts']);
/** これを超える行数のファイルを long-file（info）で知らせる（03 §1「1ファイル1責務」の目安） */
const LONG_FILE_LINES = 800;
/** import・export の from 句（静的・動的）を拾う */
const IMPORT_SPEC = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
/** export された宣言の名前を拾う（行頭の export だけ。再 export は対象外） */
const EXPORT_DECL = /^export\s+(?:async\s+)?(?:function\s*\*?|const|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

/**
 * import の指定をプロジェクト内のファイル（ROOT からの相対パス）にする。外部モジュールや見つからないものは null。
 * @param {string} fromRel import を書いたファイル
 * @param {string} spec import の指定（'@/…' か相対パス）
 * @param {Set<string>} known プロジェクト内のファイル
 * @returns {string | null} 解決したファイル
 */
function resolveImport(fromRel, spec, known) {
  const clean = spec.replace(/\?.*$/, '');
  let base;
  if (clean.startsWith('@/')) base = `src/${clean.slice(2)}`;
  else if (clean.startsWith('.')) base = join(fromRel, '..', clean).split(sep).join('/');
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.mjs`, `${base}/index.ts`]) if (known.has(candidate)) return candidate;
  return null;
}

/**
 * 識別子ごとの出現回数を数える（文字列・コメントの中も数える。使われているかの判定を甘い側に倒すため）。
 * @param {string} text ソース
 * @returns {Map<string, number>} 識別子 → 回数
 */
function countIdentifiers(text) {
  const counts = new Map();
  for (const word of text.match(/[A-Za-z_$][\w$]*/g) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

/**
 * プロジェクト全体の検査を行う。
 * - orphan-file（warn）: どこからも import されていないファイル（入口・テスト・型定義を除く）
 * - unused-export（warn）: export しているのに、ほかのファイルでも自分の中でも使われていない宣言
 * - long-file（info）: LONG_FILE_LINES 行を超えるファイル（分割の候補。件数には数えない）
 * 使う側には scripts/ も含める（マスタのテストなどが src を import するため）。
 * @sideEffect findings に追加する
 */
function auditProject() {
  const sources = [...listFiles(join(ROOT, 'src')), ...listFiles(join(ROOT, 'scripts'))]
    .map((full) => ({ full, rel: relative(ROOT, full).split(sep).join('/'), text: readFileSync(full, 'utf8') }));
  const known = new Set(sources.map((s) => s.rel));
  const imported = new Set();
  const identifiers = new Map();
  for (const s of sources) {
    for (const m of s.text.matchAll(IMPORT_SPEC)) {
      const target = resolveImport(s.rel, m[1], known);
      if (target !== null && target !== s.rel) imported.add(target);
    }
    identifiers.set(s.rel, countIdentifiers(s.text));
  }
  for (const s of sources) {
    if (!s.rel.startsWith('src/') || /\.test\.ts$/.test(s.rel)) continue;
    const lines = s.text.split(/\r?\n/);
    if (!ENTRY_FILES.has(s.rel) && !imported.has(s.rel) && !/audit-ignore:\s*orphan-file\s+\S/.test(s.text)) {
      report('orphan-file', 'warn', s.full, 1, 'どこからも import されていません。使わないなら削除する（残す理由があるなら先頭のコメントに audit-ignore: orphan-file 理由）');
    }
    if (lines.length > LONG_FILE_LINES) report('long-file', 'info', s.full, 1, `${lines.length} 行（目安 ${LONG_FILE_LINES}）。責務ごとの分割を検討する（03 §1）`);
    lines.forEach((line, i) => {
      const name = line.match(EXPORT_DECL)?.[1];
      if (name === undefined || ignored(line, 'unused-export')) return;
      const usedElsewhere = sources.some((other) => other.rel !== s.rel && identifiers.get(other.rel).has(name));
      if (!usedElsewhere && identifiers.get(s.rel).get(name) === 1) report('unused-export', 'warn', s.full, i + 1, `export ${name} はどこからも使われていません。削除する`);
    });
  }
}

for (const t of targets) {
  const full = join(ROOT, t);
  let st;
  try {
    st = statSync(full);
  } catch {
    console.error(`対象が存在しません: ${t}`);
    continue;
  }
  const files = st.isDirectory() ? listFiles(full) : /\.css$/.test(full) ? [] : [full];
  files.forEach(auditFile);
  (st.isDirectory() ? listCssFiles(full) : /\.css$/.test(full) ? [full] : []).forEach(auditCss);
}

if (targets.some((t) => t.split(/[\\/]/).filter(Boolean).join('/') === 'src')) auditProject();

const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');
const infos = findings.filter((f) => f.level === 'info');

if (asJson) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), targets, summary: { errors: errors.length, warnings: warns.length, infos: infos.length }, findings }, null, 2));
} else {
  const byCheck = {};
  for (const f of findings) (byCheck[f.check] ??= []).push(f);
  for (const [check, list] of Object.entries(byCheck).sort()) {
    console.log(`\n## ${check} (${list.length})`);
    for (const f of list) console.log(`  ${f.level.toUpperCase().padEnd(5)} ${f.file}:${f.line}  ${f.message}`);
  }
  if (infos.length > 0) console.log(`\n（info ${infos.length} 件は参考。error・warn には数えない）`);
  console.log(`\n=== 静的監査: error ${errors.length} / warn ${warns.length} / 対象 ${targets.join(', ')} ===`);
}
process.exit(errors.length > 0 && !warnOnly ? 1 : 0);
