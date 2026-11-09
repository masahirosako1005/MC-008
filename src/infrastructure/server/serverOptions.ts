/**
 * @file 連携サーバーの起動オプション（infrastructure/server 層の境界。コマンドラインと環境変数の検証）
 * 使い方：node dist-server/serverMain.mjs [--port 8787] [--host 127.0.0.1] [--db .data/cms-demo.sqlite] [--master public/master]
 *          [--static dist] [--cms-static dist-cms] [--cms-port 8788] [--tls-cert server.crt --tls-key server.key] [--trust-proxy]
 *          [--allowed-hosts app.example.jp,admin.example.jp]
 * 同じ項目は環境変数（PORT・HOST・DB_PATH・MASTER_DIR・STATIC_DIR・CMS_STATIC_DIR・CMS_PORT・TLS_CERT・TLS_KEY・TRUST_PROXY・ALLOWED_HOSTS）でも渡せる。
 * コマンドラインが環境変数より優先する。
 * 既定では自分の PC（127.0.0.1）からだけつなげる。自分の PC 以外に公開するときは TLS か --trust-proxy が要る（serverMain が確かめる）。
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
  /** 利用者アプリの画面のフォルダ */
  readonly staticDir?: string;
  /** 店舗CMS の画面のフォルダ（本番。デモは staticDir に同居） */
  readonly cmsStaticDir?: string;
  /** CMS を別のポート（別のオリジン）で出すときのポート */
  readonly cmsPort?: number;
  /** TLS のサーバー証明書（PEM）のファイル */
  readonly tlsCert?: string;
  /** TLS の秘密鍵（PEM）のファイル */
  readonly tlsKey?: string;
  /** TLS を終端する中継の後ろで動かす（X-Forwarded-* を信じる） */
  readonly trustProxy: boolean;
  /** 本番で使うホスト名（localhost・IP 以外で受け付けるもの） */
  readonly allowedHosts: readonly string[];
}

/** 既定値 */
export const DEFAULT_SERVER_OPTIONS: ServerCliOptions = Object.freeze({
  port: 8787,
  host: '127.0.0.1',
  dbPath: '.data/cms-demo.sqlite',
  masterDir: 'public/master',
  trustProxy: false,
  allowedHosts: Object.freeze([]),
});

/** 値を取る項目 */
type ValueKey = 'port' | 'host' | 'dbPath' | 'masterDir' | 'staticDir' | 'cmsStaticDir' | 'cmsPort' | 'tlsCert' | 'tlsKey' | 'allowedHosts';

/** 値を取るオプション → 項目名 */
const OPTION_KEYS: Readonly<Record<string, ValueKey>> = Object.freeze({
  '--port': 'port',
  '--host': 'host',
  '--db': 'dbPath',
  '--master': 'masterDir',
  '--static': 'staticDir',
  '--cms-static': 'cmsStaticDir',
  '--cms-port': 'cmsPort',
  '--tls-cert': 'tlsCert',
  '--tls-key': 'tlsKey',
  '--allowed-hosts': 'allowedHosts',
});

/** 値を取らないオプション */
const FLAG_OPTIONS: ReadonlySet<string> = new Set(['--trust-proxy']);

/** 環境変数 → 項目名 */
const ENV_KEYS: Readonly<Record<string, ValueKey>> = Object.freeze({
  PORT: 'port',
  HOST: 'host',
  DB_PATH: 'dbPath',
  MASTER_DIR: 'masterDir',
  STATIC_DIR: 'staticDir',
  CMS_STATIC_DIR: 'cmsStaticDir',
  CMS_PORT: 'cmsPort',
  TLS_CERT: 'tlsCert',
  TLS_KEY: 'tlsKey',
  ALLOWED_HOSTS: 'allowedHosts',
});

/** ホスト名の書式（英数字・点・コロン・ハイフン） */
const HOST_PATTERN = /^[A-Za-z0-9.:-]{1,253}$/;
/** 許可するホスト名の書式（DNS の名前） */
const DNS_NAME_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*$/;
/** ループバック（自分の PC だけ）のホスト名 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * 起動オプションの失敗を作る。
 * @param message 理由
 * @returns INVALID_INPUT
 */
function invalid(message: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', message));
}

/**
 * 待ち受けのホストが自分の PC だけか。
 * @param host --host の値
 * @returns ループバックなら true
 */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/**
 * ポート番号を読む。
 * @param value 文字列
 * @param name オプション名（失敗の文に使う）
 * @returns 成功: 0〜65535 の整数。失敗: INVALID_INPUT
 */
function parsePort(value: string, name: string): Result<number> { // audit-ignore: fnlog-missing 数値の検証だけの純粋なヘルパー（assign が記録する）
  const port = Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? ok(port) : invalid(`${name} は 0〜65535 の整数です`);
}

/**
 * 許可するホスト名の一覧を読む（',' 区切り。小文字にそろえる）。
 * @param value 文字列
 * @returns 成功: ホスト名の一覧。失敗: INVALID_INPUT
 */
function parseAllowedHosts(value: string): Result<readonly string[]> {
  const log = logger.fn('parseAllowedHosts');
  const hosts = value.split(',').map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0);
  if (hosts.some((h) => !DNS_NAME_PATTERN.test(h))) return log.fail(invalid('--allowed-hosts の書式が正しくありません'));
  return log.exit(ok(Object.freeze([...new Set(hosts)])));
}

/**
 * 値を確かめて、起動オプションに入れる。
 * @param acc 途中の起動オプション
 * @param key 項目名
 * @param value 値
 * @param name オプション名（失敗の文に使う）
 * @returns 成功: 更新した起動オプション。失敗: INVALID_INPUT
 */
function assign(acc: ServerCliOptions, key: ValueKey, value: string, name: string): Result<ServerCliOptions> {
  const log = logger.fn('assign', { key });
  if (key === 'port' || key === 'cmsPort') {
    const port = parsePort(value, name);
    return port.ok ? log.exit(ok({ ...acc, [key]: port.value })) : log.fail(port);
  }
  if (key === 'allowedHosts') {
    const hosts = parseAllowedHosts(value);
    return hosts.ok ? log.exit(ok({ ...acc, allowedHosts: hosts.value })) : log.fail(hosts);
  }
  if (key === 'host' && !HOST_PATTERN.test(value)) return log.fail(invalid(`${name} の書式が正しくありません`));
  if (value.trim() === '' || value.includes('\0')) return log.fail(invalid(`${name} が空です`));
  return log.exit(ok({ ...acc, [key]: value }));
}

/**
 * 環境変数から起動オプションを読む（無いものは既定のまま）。
 * @param env 環境変数
 * @returns 成功: 起動オプション。失敗: INVALID_INPUT
 */
function fromEnv(env: Readonly<Record<string, string | undefined>>): Result<ServerCliOptions> {
  const log = logger.fn('fromEnv');
  let options: ServerCliOptions = DEFAULT_SERVER_OPTIONS;
  for (const [name, key] of Object.entries(ENV_KEYS)) {
    const value = env[name];
    if (value === undefined || value === '') continue;
    const next = assign(options, key, value, name);
    if (!next.ok) return log.fail(next);
    options = next.value;
  }
  const trustProxy = env['TRUST_PROXY'];
  if (trustProxy === '1' || trustProxy?.toLowerCase() === 'true') options = { ...options, trustProxy: true };
  return log.exit(ok(options));
}

/**
 * TLS の証明書と鍵がそろっているか確かめる。
 * @param options 起動オプション
 * @returns 成功: そのまま。失敗: INVALID_INPUT（片方だけ）
 */
function checkTls(options: ServerCliOptions): Result<ServerCliOptions> { // audit-ignore: fnlog-missing 2項目の有無を見るだけの純粋なヘルパー（parseServerArgs が記録する）
  if ((options.tlsCert === undefined) !== (options.tlsKey === undefined)) return invalid('--tls-cert と --tls-key は両方指定してください');
  return ok(options);
}

/**
 * コマンドラインの引数（と環境変数）を起動オプションにする。
 * @param argv process.argv.slice(2)
 * @param env 環境変数（省略時は読まない）
 * @returns 成功: 起動オプション。失敗: INVALID_INPUT（知らないオプション・値が無い・書式が違う）
 */
export function parseServerArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = {}): Result<ServerCliOptions> {
  const log = logger.fn('parseServerArgs', { count: argv.length });
  const base = fromEnv(env);
  if (!base.ok) return log.fail(base);
  let options = base.value;
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i] ?? '';
    if (FLAG_OPTIONS.has(name)) {
      options = { ...options, trustProxy: true };
      continue;
    }
    const key = OPTION_KEYS[name];
    const value = argv[i + 1];
    if (key === undefined) return log.fail(invalid(`知らないオプションです: ${name}`));
    if (value === undefined) return log.fail(invalid(`${name} の値がありません`));
    const next = assign(options, key, value, name);
    if (!next.ok) return log.fail(next);
    options = next.value;
    i += 1;
  }
  const checked = checkTls(options);
  return checked.ok ? log.exit(checked) : log.fail(checked);
}
