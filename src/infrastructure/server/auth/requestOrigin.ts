/**
 * @file 要求の相手と通信の安全さを読む（infrastructure/server/auth 層。SEC-05、SEC-18）
 * TLS を終端する中継（nginx・Caddy・クラウドのロードバランサ）の後ろで動かすときは、相手の IP と https かどうかを
 * X-Forwarded-For / X-Forwarded-Proto から読む。中継が無いときにこれらのヘッダーを信じると、相手が IP を偽って
 * 回数制限をすり抜けたり、http なのに Secure の Cookie を出させたりできるので、--trust-proxy のときだけ読む。
 * X-Forwarded-For は左端を相手が自由に書けるので、**右端から「信頼する中継の段数」分だけさかのぼった値**を使う（左端は使わない）。
 * IPv6 は /64 のまとまりで数える（1人が広い範囲のアドレスを持つため）。
 */
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('infrastructure/server/auth/requestOrigin');

/** 何を信じるか */
export interface RequestTrust {
  /** X-Forwarded-* を信じるか（TLS を終端する中継の後ろで動かすとき） */
  readonly trustProxy: boolean;
  /** このサーバー自身が TLS で待ち受けているか */
  readonly tls: boolean;
  /** 信頼する中継の段数（X-Forwarded-For の右端から数える。省略時 1） */
  readonly proxyHops?: number;
}

/** 自分の PC からのつながり（ソケットの相手） */
const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** 自分の PC を指す Host の名前 */
const LOOPBACK_HOST_NAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** 中継を通ってきたことを示すヘッダー */
const FORWARDING_HEADERS: readonly string[] = ['forwarded', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'via'];

/**
 * ヘッダーの値を1つの文字列にする（配列なら結合）。
 * @param value ヘッダーの値
 * @returns 文字列（無ければ undefined）
 */
function headerText(value: string | readonly string[] | undefined): string | undefined { // audit-ignore: fnlog-missing 文字列を取り出すだけの純粋なヘルパー（呼び出し元が記録する）
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(',') : (value as string);
}

/**
 * IPv6 のアドレスを /64 のまとまりにする（回数制限の鍵）。IPv4 を埋め込んだもの（::ffff:1.2.3.4）は IPv4 として返す。
 * @param address IPv6 のアドレス（isIP で 6 と判定済み）
 * @returns 先頭 64 ビット（例 '2001:db8:1:2::/64'）か、埋め込みの IPv4
 */
export function ipv6Network64(address: string): string {
  const log = logger.fn('ipv6Network64');
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(address);
  if (mapped?.[1] !== undefined) return log.exit(mapped[1], 'mapped');
  const [head = '', tail = ''] = address.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
  const groups = [...headGroups, ...Array.from({ length: missing }, () => '0'), ...tailGroups].map((g) => g.toLowerCase().replace(/^0+(?=\w)/, ''));
  return log.exit(`${groups.slice(0, 4).join(':')}::/64`);
}

/**
 * IP アドレスを回数制限の鍵にする（IPv6 は /64）。
 * @param address IP アドレス
 * @returns 鍵（IP でなければそのまま）
 */
export function clientKeyOfAddress(address: string): string {
  return isIP(address) === 6 ? ipv6Network64(address) : address;
}

/**
 * 相手の IP アドレス（回数制限の鍵）を返す。ログには出さない（PRV）。
 * @param req 要求
 * @param trust 何を信じるか
 * @returns IP アドレス（IPv6 は /64。分からなければ 'unknown'）
 */
export function clientAddressOf(req: IncomingMessage, trust: RequestTrust): string {
  const log = logger.fn('clientAddressOf', { trustProxy: trust.trustProxy });
  if (trust.trustProxy) {
    const entries = (headerText(req.headers['x-forwarded-for']) ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const hops = Math.max(1, Math.floor(trust.proxyHops ?? 1));
    const candidate = entries[entries.length - hops];
    if (candidate !== undefined && isIP(candidate) !== 0) return log.exit(clientKeyOfAddress(candidate), 'forwarded');
  }
  return log.exit(clientKeyOfAddress(req.socket.remoteAddress ?? 'unknown'), 'socket');
}

/**
 * 相手との通信が https か（Cookie に Secure を付けるか）。
 * 中継の後ろでは、X-Forwarded-Proto がはっきり http と言わないかぎり https とみなす（付け忘れで Secure が落ちないように）。
 * @param req 要求
 * @param trust 何を信じるか
 * @returns https なら true
 */
export function isSecureRequest(req: IncomingMessage, trust: RequestTrust): boolean {
  const log = logger.fn('isSecureRequest', { tls: trust.tls, trustProxy: trust.trustProxy });
  if (trust.tls) return log.exit(true, 'tls');
  if (!trust.trustProxy) return log.exit(false, 'plain');
  const proto = headerText(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim().toLowerCase();
  return log.exit(proto !== 'http', 'forwarded');
}

/**
 * つないできたのが、中継を通らない自分の PC そのものか（デモのログインを許す相手）。
 * ソケットの相手がループバックでも、同じ PC の中継（nginx・ngrok・ポート転送・Vite の中継）を通った要求はループバックに見えるので、
 * 中継の設定（--trust-proxy）・中継を示すヘッダー・自分の PC 以外を指す Host があれば「直接ではない」とする。
 * @param req 要求
 * @param trust 何を信じるか
 * @returns 直接の自分の PC からなら true
 */
export function isDirectLoopback(req: IncomingMessage, trust: RequestTrust): boolean {
  const log = logger.fn('isDirectLoopback', { trustProxy: trust.trustProxy });
  if (trust.trustProxy) return log.exit(false, 'proxied');
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '')) return log.exit(false, 'remote');
  if (FORWARDING_HEADERS.some((name) => req.headers[name] !== undefined)) return log.exit(false, 'forwardingHeader');
  const host = (req.headers.host ?? '').toLowerCase().replace(/:\d{1,5}$/, '');
  return log.exit(LOOPBACK_HOST_NAMES.has(host), 'host');
}
