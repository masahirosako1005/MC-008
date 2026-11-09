/**
 * @file 開発・発表用の https 証明書のテスト（scripts/dev/devCert.mjs。docs/09 §7.3）
 * 作った証明書を Node（OpenSSL）の本物の TLS で確かめる：認証局を信頼すれば検証に通ること、
 * 名前の制限（localhost とプライベートな IP だけ）が本当に効くこと、使い回しと作り直しの条件。
 */
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createDevCa, ensureDevCertificates, ipBytes, isPermittedIp, issueServerCertificate } from './devCert.mjs';

const NOW = Date.parse('2026-11-09T01:00:00.000Z');
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** テスト用: 一時フォルダ */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'devcert-'));
  dirs.push(dir);
  return dir;
}

/**
 * テスト用: その証明書の https サーバーを立て、認証局だけを信頼して 127.0.0.1 につなぐ。
 * @returns {Promise<{ status?: number; error?: string }>}
 */
async function handshake(certPem, keyPem, caPem) {
  const server = createServer({ cert: certPem, key: keyPem }, (_req, res) => res.end('ok'));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  try {
    return await new Promise((done) => {
      const req = request({ host: '127.0.0.1', port, path: '/', ca: caPem }, (res) => {
        res.resume();
        done({ status: res.statusCode });
      });
      req.on('error', (e) => done({ error: `${e.code ?? ''} ${e.message}` }));
      req.end();
    });
  } finally {
    server.close();
  }
}

describe('devCert', () => {
  it('IP アドレスをバイト列にする（IPv4・IPv6 の省略形・IPv6 の中の IPv4）', () => {
    expect([...ipBytes('192.168.1.23')]).toEqual([192, 168, 1, 23]);
    expect(ipBytes('::1').toString('hex')).toBe('00000000000000000000000000000001');
    expect(ipBytes('fe80::1:2').toString('hex')).toBe('fe800000000000000000000000010002');
    expect(ipBytes('::ffff:192.168.1.2').toString('hex')).toBe('00000000000000000000ffffc0a80102');
  });

  it('認証局は用途がサーバー証明書だけで、名前の制限が付いている（OpenSSL の表示で確かめる）', () => {
    const ca = new X509Certificate(createDevCa(Date.now()).certPem);
    const text = ca.toLegacyObject();
    expect(text.ext_key_usage).toEqual(['1.3.6.1.5.5.7.3.1']);
    expect(ca.raw.includes(Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x1e]))).toBe(true);
  });

  it('置き換えられた認証局（制限なし・鍵が対でない）は使い回さず作り直す', () => {
    const dir = tempDir();
    const first = ensureDevCertificates({ dir, addresses: [], nowMs: NOW });
    const other = createDevCa(NOW);
    writeFileSync(join(dir, 'ca.key'), other.keyPem);
    const again = ensureDevCertificates({ dir, addresses: [], nowMs: NOW });
    expect(again).toMatchObject({ caCreated: true, serverCreated: true });
    expect(readFileSync(first.caCertPath, 'utf8')).not.toBe(other.certPem);
    const leaf = new X509Certificate(readFileSync(again.certPath));
    expect(leaf.verify(new X509Certificate(readFileSync(again.caCertPath)).publicKey)).toBe(true);
  });

  it('出してよい IP はループバックとプライベートな範囲だけ', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.5', '172.31.255.1', '192.168.11.4', '::1']) expect(isPermittedIp(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '2001:db8::1']) expect(isPermittedIp(ip)).toBe(false);
  });

  it('認証局と、localhost・ループバック・LAN の IP 用のサーバー証明書を作り、認証局を信頼すれば TLS の検証に通る', async () => {
    const dir = tempDir();
    const made = ensureDevCertificates({ dir, addresses: ['192.168.1.23', '8.8.8.8'], nowMs: Date.now() });
    expect(made).toMatchObject({ caCreated: true, serverCreated: true, ipAddresses: ['127.0.0.1', '::1', '192.168.1.23'], skipped: ['8.8.8.8'] });
    const ca = new X509Certificate(readFileSync(made.caCertPath));
    const leaf = new X509Certificate(readFileSync(made.certPath));
    expect(ca.ca).toBe(true);
    expect(leaf.ca).toBe(false);
    expect(leaf.checkIssued(ca) && leaf.verify(ca.publicKey)).toBe(true);
    expect(leaf.checkHost('localhost')).toBe('localhost');
    for (const ip of ['127.0.0.1', '192.168.1.23']) expect(leaf.checkIP(ip)).toBe(ip);
    expect(leaf.checkIP('8.8.8.8')).toBeUndefined();
    expect(Date.parse(leaf.validTo) - Date.now()).toBeLessThanOrEqual(398 * 86_400_000);
    const result = await handshake(readFileSync(made.certPath, 'utf8'), readFileSync(made.keyPath, 'utf8'), readFileSync(made.caCertPath, 'utf8'));
    expect(result).toEqual({ status: 200 });
  });

  it('名前の制限が効く：認証局が外の名前の証明書を出しても、TLS の検証に落ちる', async () => {
    const ca = createDevCa(Date.now());
    const rogue = issueServerCertificate(ca, { dnsNames: ['bank.example'], ipAddresses: ['127.0.0.1'], nowMs: Date.now() });
    const result = await handshake(rogue.certPem, rogue.keyPem, ca.certPem);
    expect(result.status).toBeUndefined();
    expect(result.error).toMatch(/permitted subtree violation/i);
    const ok = issueServerCertificate(ca, { dnsNames: ['localhost'], ipAddresses: ['127.0.0.1'], nowMs: Date.now() });
    expect(await handshake(ok.certPem, ok.keyPem, ca.certPem)).toEqual({ status: 200 });
  });

  it('使えるものは使い回し、IP が増えたらサーバー証明書だけ作り直す（認証局は同じ）', () => {
    const dir = tempDir();
    const first = ensureDevCertificates({ dir, addresses: ['192.168.1.23'], nowMs: NOW });
    const caPem = readFileSync(first.caCertPath, 'utf8');
    expect(ensureDevCertificates({ dir, addresses: ['192.168.1.23'], nowMs: NOW })).toMatchObject({ caCreated: false, serverCreated: false });
    expect(ensureDevCertificates({ dir, addresses: ['192.168.1.23', '10.0.0.8'], nowMs: NOW })).toMatchObject({ caCreated: false, serverCreated: true });
    expect(readFileSync(first.caCertPath, 'utf8')).toBe(caPem);
    expect(new X509Certificate(readFileSync(first.certPath)).checkIP('10.0.0.8')).toBe('10.0.0.8');
  });

  it('期限が近づいたら作り直す', () => {
    const dir = tempDir();
    ensureDevCertificates({ dir, addresses: [], nowMs: NOW });
    expect(ensureDevCertificates({ dir, addresses: [], nowMs: NOW + 360 * 86_400_000 })).toMatchObject({ caCreated: false, serverCreated: true });
  });
});
