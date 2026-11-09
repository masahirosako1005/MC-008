/**
 * @file アカウントのコマンドライン（infrastructure/server/cli 層。docs/09 CMS-A02〜A04、§7.4）
 * 最初の運営者を作る・パスワードを設定し直す・停止と再開を、サーバーを動かしている PC で行う（画面からは運営者だけができる）。
 *
 *   node dist-server/serverMain.mjs account create --login <ID> --name <表示名> --role operator|shopOwner [--shops s_mm04,s_mm05] [--db ...] [--master ...]
 *   node dist-server/serverMain.mjs account list [--db ...]
 *   node dist-server/serverMain.mjs account set-password --login <ID> [--db ...]
 *   node dist-server/serverMain.mjs account suspend|resume --login <ID> [--db ...]
 *
 * パスワードは環境変数 CMS_ACCOUNT_PASSWORD か、画面に出さない入力で受け取る（コマンドラインの引数には書かない＝履歴に残さない）。
 * 出力は人が読むためのものなので標準出力へ書く（ログではない）。アカウントID 以外の個人情報は出さない。
 */
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { CmsAccountDto, CmsRole } from '@/application/dto/CmsAuthDto';
import { MasterDataLoader } from '@/infrastructure/master/MasterDataLoader';
import { CryptoIdGenerator } from '@/infrastructure/random/CryptoIdGenerator';
import { AuthService, LOGIN_RATE_LIMIT } from '@/infrastructure/server/auth/AuthService';
import { FixedWindowRateLimiter } from '@/infrastructure/server/http/FixedWindowRateLimiter';
import { nodeFetchText } from '@/infrastructure/server/nodeFetchText';
import { DEFAULT_SERVER_OPTIONS } from '@/infrastructure/server/serverOptions';
import { CmsDatabase } from '@/infrastructure/server/sqlite/CmsDatabase';
import { SqliteAuthStore } from '@/infrastructure/server/sqlite/SqliteAuthStore';
import { SystemClock } from '@/infrastructure/time/SystemClock';

const logger = createLogger('infrastructure/server/cli/accountCommand');

/** パスワードを渡す環境変数 */
export const PASSWORD_ENV = 'CMS_ACCOUNT_PASSWORD';
/** 操作者として記録に残す名前 */
const CLI_ACTOR = 'cli';
/** 使い方 */
const USAGE = [
  '使い方:',
  '  account create --login <ID> --name <表示名> --role operator|shopOwner [--shops s_xx,s_yy] [--db <path>] [--master <dir>]',
  '  account list [--db <path>]',
  '  account set-password --login <ID> [--db <path>]',
  '  account suspend|resume --login <ID> [--db <path>]',
  `  パスワードは環境変数 ${PASSWORD_ENV} か、入力で受け取ります。`,
].join('\n');

/** 読んだ引数 */
interface AccountArgs {
  readonly command: string;
  readonly values: Readonly<Record<string, string>>;
}

/**
 * 標準出力に1行書く（人が読むための出力。ログではない）。
 * @param line 1行
 * @sideEffect 標準出力に書く
 */
function print(line: string): void {
  stdout.write(`${line}\n`);
}

/**
 * 引数を読む（'--名前 値' の並び）。
 * @param argv 'account' の後ろの引数
 * @returns 成功: コマンドと値。失敗: INVALID_INPUT
 */
function parseArgs(argv: readonly string[]): Result<AccountArgs> {
  const log = logger.fn('parseArgs', { count: argv.length });
  const [command = '', ...rest] = argv;
  const values: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i] ?? '';
    const value = rest[i + 1];
    if (!name.startsWith('--') || value === undefined) return log.fail(fail(AppError.of('INVALID_INPUT', `引数が正しくありません: ${name}`)));
    values[name.slice(2)] = value;
  }
  return log.exit(ok({ command, values }));
}

/**
 * パスワードを受け取る（環境変数か、画面に出さない入力）。
 * @param env 環境変数
 * @param prompt 入力の案内
 * @returns パスワード
 * @sideEffect 標準入力を読む
 */
async function readPassword(env: Readonly<Record<string, string | undefined>>, prompt: string): Promise<string> {
  const log = logger.fn('readPassword', { fromEnv: env[PASSWORD_ENV] !== undefined });
  const fromEnv = env[PASSWORD_ENV];
  if (fromEnv !== undefined && fromEnv.length > 0) return log.exit(fromEnv);
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(prompt);
    rl.close();
    return log.exit(answer);
  }
  return log.exit(await readHidden(prompt));
}

/**
 * 端末から、文字を映さずに1行読む。
 * @param prompt 入力の案内
 * @returns 入力された文字列
 * @sideEffect 端末を raw モードにして読む（終わったら戻す）
 */
function readHidden(prompt: string): Promise<string> {
  const log = logger.fn('readHidden');
  stdout.write(prompt);
  return log.exit(new Promise<string>((resolve) => {
    let buffer = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    /** 1文字ずつ受け取る（Enter で確定、Ctrl+C で中止、Backspace で1字消す） */
    const onData = (chunk: string): void => { // audit-ignore: fnlog-missing 1文字ごとに呼ばれる入力の処理（readHidden で記録する）
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(buffer);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
    };
    stdin.on('data', onData);
  }));
}

/**
 * アカウントを1行にする（パスワードは出さない）。
 * @param account アカウント
 * @returns 1行
 */
function formatAccount(account: CmsAccountDto): string { // audit-ignore: fnlog-missing 1行を組み立てるだけの純粋なヘルパー
  const shops = account.role === 'operator' ? '全店舗' : account.shopIds.join(',');
  return `${account.id}  ${account.loginId}  ${account.role}  ${account.status}${account.locked ? '(locked)' : ''}${account.demo ? '(demo)' : ''}  ${shops}  ${account.displayName}`;
}

/**
 * ログインID でアカウントを探す（--login の値。大文字は小文字にそろえる）。
 * @param auth ログイン・アカウント
 * @param rawLoginId --login の値
 * @returns 成功: アカウント。失敗: ACCOUNT_NOT_FOUND / STORAGE_FAILED
 */
function findByLogin(auth: AuthService, rawLoginId: string | undefined): Result<CmsAccountDto> {
  const log = logger.fn('findByLogin');
  const listed = auth.listAccounts();
  if (!listed.ok) return log.fail(listed);
  const found = listed.value.find((a) => a.loginId === (rawLoginId ?? '').trim().toLowerCase());
  return found === undefined ? log.fail(fail(AppError.of('ACCOUNT_NOT_FOUND', 'アカウントが見つかりません'))) : log.exit(ok(found));
}

/**
 * 1つのコマンドを実行する。
 * @param auth ログイン・アカウント
 * @param args 引数
 * @param env 環境変数
 * @returns 成功: 出力する行。失敗: AppError
 * @sideEffect DB を書き換える。パスワードを読む
 */
async function execute(auth: AuthService, args: AccountArgs, env: Readonly<Record<string, string | undefined>>): Promise<Result<readonly string[]>> {
  const log = logger.fn('execute', { command: args.command });
  const { values } = args;
  switch (args.command) {
    case 'list': {
      const listed = auth.listAccounts();
      return log.exit(listed.ok ? ok(listed.value.length === 0 ? ['アカウントはありません'] : listed.value.map(formatAccount)) : listed);
    }
    case 'create': {
      const role = values['role'];
      if (role !== 'operator' && role !== 'shopOwner') return log.fail(fail(AppError.of('INVALID_INPUT', '--role は operator か shopOwner です')));
      const password = await readPassword(env, '新しいパスワード: ');
      const created = await auth.createAccount(CLI_ACTOR, {
        loginId: values['login'] ?? '', displayName: values['name'] ?? '', role: role as CmsRole,
        shopIds: (values['shops'] ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0), password,
      });
      return log.exit(created.ok ? ok([`作りました: ${formatAccount(created.value)}`]) : created);
    }
    case 'set-password': {
      const account = findByLogin(auth, values['login']);
      if (!account.ok) return log.fail(account);
      const password = await readPassword(env, '新しいパスワード: ');
      const reset = await auth.resetAccountPassword(CLI_ACTOR, { accountId: account.value.id, newPassword: password });
      return log.exit(reset.ok ? ok([`パスワードを設定しました: ${account.value.id}`]) : reset);
    }
    case 'suspend':
    case 'resume': {
      const account = findByLogin(auth, values['login']);
      if (!account.ok) return log.fail(account);
      const changed = auth.setAccountStatus(CLI_ACTOR, { accountId: account.value.id, status: args.command === 'suspend' ? 'suspended' : 'active' });
      return log.exit(changed.ok ? ok([formatAccount(changed.value)]) : changed);
    }
    default:
      return log.fail(fail(AppError.of('INVALID_INPUT', USAGE)));
  }
}

/**
 * account サブコマンドを実行する。
 * @param argv 'account' の後ろの引数
 * @param env 環境変数（DB_PATH・MASTER_DIR・CMS_ACCOUNT_PASSWORD）
 * @param mode サーバーの版（デモのアカウントの扱いに使う）
 * @returns 終了コード（0: 成功、1: 失敗、2: 引数の誤り）
 * @sideEffect DB を開いて書き換える。標準出力に書く
 */
export async function runAccountCommand(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, mode: 'demo' | 'production'): Promise<number> {
  const log = logger.fn('runAccountCommand', { count: argv.length, mode });
  const args = parseArgs(argv);
  if (!args.ok) {
    print(args.error.message);
    print(USAGE);
    return log.exit(2);
  }
  const dbPath = args.value.values['db'] ?? env['DB_PATH'] ?? DEFAULT_SERVER_OPTIONS.dbPath;
  const masterDir = args.value.values['master'] ?? env['MASTER_DIR'] ?? DEFAULT_SERVER_OPTIONS.masterDir;
  const master = await MasterDataLoader.load(nodeFetchText(masterDir));
  if (!master.ok) {
    print(`マスタを読めませんでした: ${master.error.message}`);
    return log.exit(1);
  }
  const db = CmsDatabase.open(dbPath);
  if (!db.ok) {
    print(`データベースを開けませんでした: ${db.error.message}`);
    return log.exit(1);
  }
  const auth = new AuthService({
    store: new SqliteAuthStore(db.value), clock: new SystemClock(), ids: new CryptoIdGenerator(), spots: master.value.spots, mode,
    loginLimiter: new FixedWindowRateLimiter(LOGIN_RATE_LIMIT),
  });
  try {
    const result = await execute(auth, args.value, env);
    if (!result.ok) {
      print(result.error.message);
      return log.exit(result.error.code === 'INVALID_INPUT' ? 2 : 1);
    }
    for (const line of result.value) print(line);
    return log.exit(0);
  } finally {
    db.value.close();
  }
}
