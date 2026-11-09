#!/usr/bin/env node
/**
 * @file 開発・発表用の https 証明書を作る（依存ライブラリなし / Node 24 の node:crypto だけ。docs/09 §7.3）
 *
 * 作るもの（既定の置き場所はユーザーごとのフォルダ＝defaultTlsDir()。Windows は %LOCALAPPDATA%\machiquest\dev-tls）:
 *   ca.crt / ca.key         … 手元用の認証局。スマホに ca.crt を入れて信頼すると、警告なしで https を開ける
 *   server.crt / server.key … 連携サーバーの証明書（localhost・127.0.0.1・::1・この PC の LAN の IP 用。1年）
 *
 * 安全のための作り：
 *   - 認証局には「名前の制限」（Name Constraints・重要）を付け、localhost とプライベートな IP（127/8・10/8・172.16/12・192.168/16・::1）、
 *     主体の名前は O=MachiQuest Dev の下だけに絞る。用途もサーバー証明書（serverAuth）だけにする。
 *     OpenSSL・主要なブラウザ（Chrome・Safari・Firefox）はこの制限に従うが、従わない環境（Android のアプリ内の表示など）もありうる。
 *     そのため認証局の鍵は人に渡さず、発表が終わったらスマホから認証局を消す
 *   - 置き場所はリポジトリの外のユーザーごとのフォルダ（共有 PC でほかの利用者に読まれない）。POSIX では 700/600 にそろえる
 *   - 使い回す認証局は、このスクリプトが作った形（制限・用途あり、鍵が対）かを毎回確かめる。違えば作り直す
 *   - 鍵は EC P-256。サーバー証明書は1年（ブラウザの上限 398日以内）。IP が変わったら作り直す。認証局は使い回す（スマホに入れ直さなくてよい）
 *
 * 使い方: node scripts/dev/devCert.mjs [置き場所]   （scripts/dev/backend.mjs serve が --host 0.0.0.0 / --tls のときに自動で呼ぶ）
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY_MS = 86_400_000;
/** サーバー証明書の有効日数（ブラウザの上限 398日以内） */
export const SERVER_CERT_DAYS = 365;
/** 認証局の有効日数 */
export const CA_CERT_DAYS = 3650;
/** 残りがこれより短ければ作り直す（日） */
const RENEW_BEFORE_DAYS = 14;

/** 認証局が証明書を出してよい IP の範囲（プライベート・ループバックだけ） */
export const PERMITTED_IP_RANGES = Object.freeze([
  ['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['::1', 128],
]);

// ---------- DER（ASN.1）の組み立て ----------

/**
 * 長さを DER の形にする。
 * @param {number} n 長さ
 * @returns {Buffer}
 */
function derLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/**
 * タグ・長さ・中身をつなぐ。
 * @param {number} tag タグ
 * @param {Buffer} content 中身
 * @returns {Buffer}
 */
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const octet = (b) => tlv(0x04, b);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bitString = (b, unusedBits = 0) => tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), b]));
/** 文脈タグ（構造型。[n] EXPLICIT や SEQUENCE の中身） */
const ctxCons = (n, content) => tlv(0xa0 + n, content);
/** 文脈タグ（基本型。[n] IMPLICIT） */
const ctxPrim = (n, content) => tlv(0x80 + n, content);

/**
 * 正の整数を DER にする。
 * @param {Buffer} raw 大きい順のバイト列
 * @returns {Buffer}
 */
function derInteger(raw) {
  let b = raw;
  while (b.length > 1 && b[0] === 0 && (b[1] & 0x80) === 0) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

/**
 * OID を DER にする。
 * @param {string} dotted 例 '2.5.29.17'
 * @returns {Buffer}
 */
function oid(dotted) {
  const parts = dotted.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const value of parts.slice(2)) {
    const stack = [value & 0x7f];
    for (let x = Math.floor(value / 128); x > 0; x = Math.floor(x / 128)) stack.unshift((x & 0x7f) | 0x80);
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}

/**
 * 日時を DER にする（2050年より前は UTCTime、以後は GeneralizedTime）。
 * @param {number} ms エポックミリ秒
 * @returns {Buffer}
 */
function derTime(ms) {
  const iso = new Date(ms).toISOString();
  const digits = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return Number(iso.slice(0, 4)) < 2050 ? tlv(0x17, Buffer.from(digits.slice(2), 'ascii')) : tlv(0x18, Buffer.from(digits, 'ascii'));
}

/**
 * IP アドレスをバイト列にする（IPv4 は4バイト、IPv6 は16バイト）。
 * @param {string} ip IP アドレス
 * @returns {Buffer}
 */
export function ipBytes(ip) {
  if (isIP(ip) === 4) return Buffer.from(ip.split('.').map(Number));
  if (isIP(ip) !== 6) throw new Error(`IP アドレスではありません: ${ip}`);
  // 末尾が IPv4 の書き方（例 ::ffff:192.168.1.2）なら、2つの16進のかたまりに直す
  const embedded = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip.split('%')[0]);
  const plain = embedded === null ? ip.split('%')[0] : `${embedded[1]}${ipBytes(embedded[2]).toString('hex').replace(/^(.{4})(.{4})$/, '$1:$2')}`;
  const [head, tail = ''] = plain.split('::');
  const groups = (s) => (s === '' ? [] : s.split(':'));
  const left = groups(head);
  const right = groups(tail);
  const words = plain.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  const out = Buffer.alloc(16);
  words.forEach((w, i) => out.writeUInt16BE(Number.parseInt(w, 16), i * 2));
  return out;
}

/**
 * 接頭辞の長さから、マスクのバイト列を作る。
 * @param {number} bits 接頭辞の長さ
 * @param {number} size 4 か 16
 * @returns {Buffer}
 */
function maskBytes(bits, size) {
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    const ones = Math.max(0, Math.min(8, bits - i * 8));
    out[i] = ones === 0 ? 0 : (0xff << (8 - ones)) & 0xff;
  }
  return out;
}

/**
 * DER の要素を1つ読む（タグ・中身の位置・終わりの位置）。
 * @param {Buffer} buf DER
 * @param {number} at 読み始める位置
 * @returns {{ start: number; contentStart: number; end: number }}
 */
function readTlv(buf, at) {
  const first = buf[at + 1];
  if (first < 0x80) return { start: at, contentStart: at + 2, end: at + 2 + first };
  const count = first & 0x7f;
  let length = 0;
  for (let i = 0; i < count; i++) length = length * 256 + buf[at + 2 + i];
  return { start: at, contentStart: at + 2 + count, end: at + 2 + count + length };
}

/**
 * 証明書の「主体の名前」を DER のまま取り出す（発行者の名前に、認証局の名前をそのまま写すため）。
 * @param {X509Certificate} cert 証明書
 * @returns {Buffer}
 */
function subjectDerOf(cert) {
  const der = cert.raw;
  const tbs = readTlv(der, readTlv(der, 0).contentStart);
  let at = tbs.contentStart;
  // version [0]・serialNumber・signature・issuer・validity の5つを飛ばすと subject
  for (let i = 0; i < 5; i++) at = readTlv(der, at).end;
  const subject = readTlv(der, at);
  return der.subarray(subject.start, subject.end);
}

/**
 * IP が範囲に入っているか。
 * @param {string} ip IP アドレス
 * @param {string} base 範囲の先頭
 * @param {number} bits 接頭辞の長さ
 * @returns {boolean}
 */
function inRange(ip, base, bits) {
  if (isIP(ip) !== isIP(base)) return false;
  const a = ipBytes(ip);
  const b = ipBytes(base);
  const m = maskBytes(bits, a.length);
  return a.every((byte, i) => (byte & m[i]) === (b[i] & m[i]));
}

/**
 * 認証局が出してよい IP か（名前の制限の内側か）。
 * @param {string} ip IP アドレス
 * @returns {boolean}
 */
export function isPermittedIp(ip) {
  return PERMITTED_IP_RANGES.some(([base, bits]) => inRange(ip, base, bits));
}

/**
 * 拡張を1つ作る。
 * @param {string} id OID
 * @param {boolean} critical 重要か
 * @param {Buffer} value 中身（DER）
 * @returns {Buffer}
 */
const extension = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octet(value));

/**
 * 名前（CN と O）を作る。
 * @param {string} cn 一般名
 * @returns {Buffer}
 */
const nameOf = (cn) => seq(set(seq(oid('2.5.4.10'), utf8('MachiQuest Dev'))), set(seq(oid('2.5.4.3'), utf8(cn))));
/** 組織名だけの名前（名前の制限の directoryName に使う。nameOf の先頭と同じ並び） */
const ORGANIZATION_NAME = seq(set(seq(oid('2.5.4.10'), utf8('MachiQuest Dev'))));
/** 用途：サーバー証明書（serverAuth）だけ */
const SERVER_AUTH_EKU = seq(oid('1.3.6.1.5.5.7.3.1'));
/** 名前の制限（2.5.29.30）と用途（2.5.29.37）の OID の DER（使い回す認証局に付いているかを確かめる） */
const NAME_CONSTRAINTS_OID_DER = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x1e]);
const EKU_OID_DER = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x25]);

/** 署名の方式（ECDSA with SHA-256） */
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

/**
 * 公開鍵の識別子（SHA-256 の先頭20バイト）。
 * @param {import('node:crypto').KeyObject} publicKey 公開鍵
 * @returns {Buffer}
 */
const keyIdOf = (publicKey) => createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest().subarray(0, 20);

/**
 * 証明書を組み立てて署名する。
 * @param {{ subject: Buffer; issuer: Buffer; publicKey: import('node:crypto').KeyObject; signingKey: import('node:crypto').KeyObject; notBefore: number; notAfter: number; extensions: Buffer[] }} spec 名前は DER
 * @returns {string} PEM
 */
function buildCertificate(spec) {
  const serial = randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x01;
  const tbs = seq(
    ctxCons(0, derInteger(Buffer.from([2]))),
    derInteger(serial),
    ECDSA_SHA256,
    spec.issuer,
    seq(derTime(spec.notBefore), derTime(spec.notAfter)),
    spec.subject,
    spec.publicKey.export({ type: 'spki', format: 'der' }),
    ctxCons(3, seq(...spec.extensions)),
  );
  const der = seq(tbs, ECDSA_SHA256, bitString(sign('sha256', tbs, spec.signingKey)));
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * 認証局の名前の制限（localhost とプライベートな IP だけ）を作る。
 * @returns {Buffer}
 */
function nameConstraints() {
  const subtrees = [
    // 主体の名前は O=MachiQuest Dev の下だけ（DNS 名・IP 以外の名前での悪用も狭める）
    seq(ctxCons(4, ORGANIZATION_NAME)),
    seq(ctxPrim(2, Buffer.from('localhost', 'ascii'))),
    ...PERMITTED_IP_RANGES.map(([base, bits]) => {
      const addr = ipBytes(base);
      return seq(ctxPrim(7, Buffer.concat([addr, maskBytes(bits, addr.length)])));
    }),
  ];
  return seq(ctxCons(0, Buffer.concat(subtrees)));
}

/**
 * 手元用の認証局を作る。
 * @param {number} nowMs 今（エポックミリ秒）
 * @returns {{ certPem: string; keyPem: string }}
 */
export function createDevCa(nowMs) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const name = nameOf(`MachiQuest Dev CA (${hostname().replace(/[^A-Za-z0-9-]/g, '').slice(0, 40)})`);
  const certPem = buildCertificate({
    subject: name, issuer: name, publicKey, signingKey: privateKey, notBefore: nowMs - 60 * 60 * 1000, notAfter: nowMs + CA_CERT_DAYS * DAY_MS,
    extensions: [
      extension('2.5.29.19', true, seq(bool(true), derInteger(Buffer.from([0])))),
      extension('2.5.29.15', true, bitString(Buffer.from([0x06]), 1)),
      // 認証局にも用途を付け、コード署名・メール・クライアント認証の証明書には使えないようにする
      extension('2.5.29.37', false, SERVER_AUTH_EKU),
      extension('2.5.29.14', false, octet(keyIdOf(publicKey))),
      extension('2.5.29.30', true, nameConstraints()),
    ],
  });
  return { certPem, keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}

/**
 * 認証局でサーバー証明書を出す（名前の確認はしない。ふつうは ensureDevCertificates から呼ぶ）。
 * @param {{ certPem: string; keyPem: string }} ca 認証局
 * @param {{ dnsNames: string[]; ipAddresses: string[]; nowMs: number }} spec 名前と今
 * @returns {{ certPem: string; keyPem: string }}
 */
export function issueServerCertificate(ca, spec) {
  const caCert = new X509Certificate(ca.certPem);
  const caKey = createPrivateKey(ca.keyPem);
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const san = seq(...spec.dnsNames.map((d) => ctxPrim(2, Buffer.from(d, 'ascii'))), ...spec.ipAddresses.map((ip) => ctxPrim(7, ipBytes(ip))));
  const certPem = buildCertificate({
    subject: nameOf('localhost'), issuer: subjectDerOf(caCert), publicKey, signingKey: caKey,
    notBefore: spec.nowMs - 60 * 60 * 1000, notAfter: spec.nowMs + SERVER_CERT_DAYS * DAY_MS,
    extensions: [
      extension('2.5.29.19', true, seq()),
      extension('2.5.29.15', true, bitString(Buffer.from([0x80]), 7)),
      extension('2.5.29.37', false, SERVER_AUTH_EKU),
      extension('2.5.29.17', false, san),
      extension('2.5.29.14', false, octet(keyIdOf(publicKey))),
      extension('2.5.29.35', false, seq(ctxPrim(0, keyIdOf(caCert.publicKey)))),
    ],
  });
  return { certPem, keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}

/**
 * この PC の LAN の IPv4 アドレス（内部用を除く）。
 * @returns {string[]}
 */
export function localIpv4Addresses() {
  return Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
}

/**
 * ファイルの証明書を読む（無い・壊れていれば undefined）。
 * @param {string} path 証明書のファイル
 * @returns {X509Certificate | undefined}
 */
function readCertificate(path) {
  try {
    return existsSync(path) ? new X509Certificate(readFileSync(path)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 証明書がまだ十分に使えるか。
 * @param {X509Certificate} cert 証明書
 * @param {number} nowMs 今
 * @returns {boolean}
 */
const isFresh = (cert, nowMs) => Date.parse(cert.validTo) - nowMs > RENEW_BEFORE_DAYS * DAY_MS && Date.parse(cert.validFrom) <= nowMs;

/**
 * 秘密鍵を書く（所有者だけが読める権限）。
 * @param {string} path ファイル
 * @param {string} pem 中身
 */
const writeKey = (path, pem) => {
  writeFileSync(path, pem, { mode: 0o600 });
  chmodSync(path, 0o600);
};

/**
 * 秘密鍵が証明書の公開鍵と対になっているか。
 * @param {X509Certificate} cert 証明書
 * @param {string} keyPath 秘密鍵のファイル
 * @returns {boolean}
 */
function keyMatches(cert, keyPath) {
  try {
    const fromKey = createPublicKey(createPrivateKey(readFileSync(keyPath))).export({ type: 'spki', format: 'der' });
    return fromKey.equals(cert.publicKey.export({ type: 'spki', format: 'der' }));
  } catch {
    return false;
  }
}

/**
 * 使い回してよい認証局か（このスクリプトが作った形：名前の制限と用途が付き、鍵が対で、期限が十分）。
 * ほかの人が置き換えた制限なしの認証局を、知らずにスマホへ入れないようにする。
 * @param {X509Certificate | undefined} cert 認証局の証明書
 * @param {string} keyPath 秘密鍵のファイル
 * @param {number} nowMs 今
 * @returns {boolean}
 */
function isUsableCa(cert, keyPath, nowMs) {
  if (cert === undefined || !cert.ca || !isFresh(cert, nowMs) || !existsSync(keyPath)) return false;
  return cert.raw.includes(NAME_CONSTRAINTS_OID_DER) && cert.raw.includes(EKU_OID_DER) && cert.verify(cert.publicKey) && keyMatches(cert, keyPath);
}

/**
 * 認証局を用意する（使えるものがあれば使い回す）。
 * @param {string} dir 置き場所
 * @param {number} nowMs 今
 * @returns {{ ca: { certPem: string; keyPem: string }; created: boolean }}
 */
function ensureCa(dir, nowMs) {
  const certPath = join(dir, 'ca.crt');
  const keyPath = join(dir, 'ca.key');
  if (isUsableCa(readCertificate(certPath), keyPath, nowMs)) {
    chmodSync(keyPath, 0o600);
    return { ca: { certPem: readFileSync(certPath, 'utf8'), keyPem: readFileSync(keyPath, 'utf8') }, created: false };
  }
  const ca = createDevCa(nowMs);
  writeFileSync(certPath, ca.certPem);
  writeKey(keyPath, ca.keyPem);
  return { ca, created: true };
}

/**
 * 既定の置き場所（ユーザーごとのフォルダ。リポジトリの外）。
 * Windows は %LOCALAPPDATA%（本人・SYSTEM・管理者だけが読める）、それ以外は ~/.local/share（フォルダを 700 にする）。
 * リポジトリのフォルダは共有 PC だとほかの利用者も読み書きできることがあるので、認証局の鍵を置かない。
 * @returns {string}
 */
export function defaultTlsDir() {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    : process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(base, 'machiquest', 'dev-tls');
}

/**
 * 証明書を用意する（認証局は使い回し、サーバー証明書は名前が足りない・期限が近い・認証局が変わったときに作り直す）。
 * @param {{ dir?: string; addresses?: string[]; nowMs?: number }} [opts] 置き場所・LAN の IP（省略時はこの PC のもの）・今
 * @returns {{ dir: string; caCertPath: string; certPath: string; keyPath: string; ipAddresses: string[]; skipped: string[]; caCreated: boolean; serverCreated: boolean }}
 */
export function ensureDevCertificates(opts = {}) {
  const dir = resolve(opts.dir ?? defaultTlsDir());
  const nowMs = opts.nowMs ?? Date.now();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const { ca, created: caCreated } = ensureCa(dir, nowMs);
  const lan = opts.addresses ?? localIpv4Addresses();
  const ipAddresses = [...new Set(['127.0.0.1', '::1', ...lan.filter(isPermittedIp)])];
  const skipped = lan.filter((ip) => !isPermittedIp(ip));
  const certPath = join(dir, 'server.crt');
  const keyPath = join(dir, 'server.key');
  const current = readCertificate(certPath);
  const caCert = new X509Certificate(ca.certPem);
  const covers = current !== undefined && current.checkHost('localhost') !== undefined && ipAddresses.every((ip) => current.checkIP(ip) !== undefined);
  const reusable = !caCreated && covers && isFresh(current, nowMs) && current.checkIssued(caCert) && current.verify(caCert.publicKey) && existsSync(keyPath) && keyMatches(current, keyPath);
  if (reusable) chmodSync(keyPath, 0o600);
  else {
    const server = issueServerCertificate(ca, { dnsNames: ['localhost'], ipAddresses, nowMs });
    writeFileSync(certPath, server.certPem);
    writeKey(keyPath, server.keyPem);
  }
  return { dir, caCertPath: join(dir, 'ca.crt'), certPath, keyPath, ipAddresses, skipped, caCreated, serverCreated: !reusable };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = ensureDevCertificates({ dir: process.argv[2] });
  console.log(JSON.stringify(result, null, 2));
}
