/**
 * @file 連携サーバーの起動オプション（infrastructure/server 層の境界。コマンドラインの検証）
 * 使い方：node dist-server/serverMain.mjs [--port 8787] [--host 127.0.0.1] [--db .data/cms-demo.sqlite] [--master public/master] [--static dist-backend]
 * 既定では自分の PC（127.0.0.1）からだけつなげる。スマホから開くときだけ --host 0.0.0.0 にする（ログインが無いため）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';

const logger = createLogger('infrastructure/server/serverOptions');

/** 起動オプション */
export interface ServerCliOptions {
  readonly port: number;
  readonly host: string;
  readonly dbPath: string;
  readonly masterDir: string;
  readonly staticDir?: string;
}

/** 既定値 */
export const DEFAULT_SERVER_OPTIONS: ServerCliOptions = Object.freeze({
  port: 8787,
  host: '127.0.0.1',
  dbPath: '.data/cms-demo.sqlite',
  masterDir: 'public/master',
});

/** 値を取るオプション → 項目名 */
const OPTION_KEYS: Readonly<Record<string, 'port' | 'host' | 'dbPath' | 'masterDir' | 'staticDir'>> = Object.freeze({
  '--port': 'port',
  '--host': 'host',
  '--db': 'dbPath',
  '--master': 'masterDir',
  '--static': 'staticDir',
});

/** ホスト名の書式（英数字・点・コロン・ハイフン） */
const HOST_PATTERN = /^[A-Za-z0-9.:-]{1,253}$/;

/**
 * 起動オプションの失敗を作る。
 * @param message 理由
 * @returns INVALID_INPUT
 */
function invalid(message: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', message));
}

/**
 * 値を確かめて、起動オプションに入れる。
 * @param acc 途中の起動オプション
 * @param key 項目名
 * @param value 値
 * @returns 成功: 更新した起動オプション。失敗: INVALID_INPUT
 */
function assign(acc: ServerCliOptions, key: 'port' | 'host' | 'dbPath' | 'masterDir' | 'staticDir', value: string): Result<ServerCliOptions> {
  const log = logger.fn('assign', { key });
  if (key === 'port') {
    const port = Number(value);
    return Number.isInteger(port) && port >= 0 && port <= 65535 ? log.exit(ok({ ...acc, port })) : log.fail(invalid('--port は 0〜65535 の整数です'));
  }
  if (key === 'host' && !HOST_PATTERN.test(value)) return log.fail(invalid('--host の書式が正しくありません'));
  if (value.trim() === '' || value.includes('\0')) return log.fail(invalid(`${key} が空です`));
  return log.exit(ok({ ...acc, [key]: value }));
}

/**
 * コマンドラインの引数を起動オプションにする。
 * @param argv process.argv.slice(2)
 * @returns 成功: 起動オプション。失敗: INVALID_INPUT（知らないオプション・値が無い・書式が違う）
 */
export function parseServerArgs(argv: readonly string[]): Result<ServerCliOptions> {
  const log = logger.fn('parseServerArgs', { count: argv.length });
  let options: ServerCliOptions = DEFAULT_SERVER_OPTIONS;
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i] ?? '';
    const key = OPTION_KEYS[name];
    const value = argv[i + 1];
    if (key === undefined) return log.fail(invalid(`知らないオプションです: ${name}`));
    if (value === undefined) return log.fail(invalid(`${name} の値がありません`));
    const next = assign(options, key, value);
    if (!next.ok) return log.fail(next);
    options = next.value;
  }
  return log.exit(ok(options));
}
