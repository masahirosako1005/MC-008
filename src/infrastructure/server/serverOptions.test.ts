/**
 * @file 連携サーバーの起動オプションと、画面の配信のパス検証のテスト（infrastructure/server 層・テスト）
 */
import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStaticPath } from '@/infrastructure/server/http/staticFiles';
import { DEFAULT_SERVER_OPTIONS, isLoopbackHost, parseServerArgs } from '@/infrastructure/server/serverOptions';

describe('parseServerArgs', () => {
  it('何も無ければ既定（自分の PC だけ・8787）', () => {
    const parsed = parseServerArgs([]);
    expect(parsed.ok && parsed.value).toEqual(DEFAULT_SERVER_OPTIONS);
    expect(DEFAULT_SERVER_OPTIONS.host).toBe('127.0.0.1');
  });

  it('値を読み、知らないオプション・値の無いもの・範囲外のポートは断る', () => {
    const parsed = parseServerArgs(['--port', '9000', '--host', '0.0.0.0', '--static', 'dist-backend']);
    expect(parsed.ok && parsed.value).toMatchObject({ port: 9000, host: '0.0.0.0', staticDir: 'dist-backend' });
    for (const bad of [['--x', '1'], ['--port'], ['--port', '70000'], ['--host', 'a b'], ['--db', ' ']]) expect(parseServerArgs(bad).ok).toBe(false);
  });

  it('本番向けの項目：CMS の別ポート・TLS・中継・許可するホスト名（TLS は証明書と鍵の両方）', () => {
    const parsed = parseServerArgs(['--cms-static', 'dist-cms', '--cms-port', '8788', '--tls-cert', 'a.crt', '--tls-key', 'a.key', '--trust-proxy', '--allowed-hosts', 'App.Example.jp, admin.example.jp']);
    expect(parsed.ok && parsed.value).toMatchObject({ cmsStaticDir: 'dist-cms', cmsPort: 8788, tlsCert: 'a.crt', tlsKey: 'a.key', trustProxy: true, allowedHosts: ['app.example.jp', 'admin.example.jp'] });
    expect(parseServerArgs(['--tls-cert', 'a.crt']).ok).toBe(false);
    expect(parseServerArgs(['--allowed-hosts', 'bad host']).ok).toBe(false);
    expect(parseServerArgs(['--cms-port', '99999']).ok).toBe(false);
  });

  it('環境変数でも渡せ、コマンドラインが優先する', () => {
    const parsed = parseServerArgs(['--port', '9001'], { PORT: '9000', HOST: '0.0.0.0', TRUST_PROXY: '1', ALLOWED_HOSTS: 'app.example.jp', DB_PATH: '/var/lib/kayoimachi/cms.sqlite' });
    expect(parsed.ok && parsed.value).toMatchObject({ port: 9001, host: '0.0.0.0', trustProxy: true, allowedHosts: ['app.example.jp'], dbPath: '/var/lib/kayoimachi/cms.sqlite' });
    expect(parseServerArgs([], { PORT: 'abc' }).ok).toBe(false);
  });

  it('ループバックの判定', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.0.10')).toBe(false);
  });
});

describe('resolveStaticPath', () => {
  const root = resolve('dist-backend');
  it('フォルダの中だけを返す（../・\\・NUL・符号化した ../ を拒否＝SEC-16）', () => {
    expect(resolveStaticPath(root, '/')).toBe(resolve(root, 'index.html'));
    expect(resolveStaticPath(root, '/assets/a.js')).toBe(`${root}${sep}assets${sep}a.js`);
    for (const bad of ['/../package.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/a%00.js', '/%E0%A4%A']) expect(resolveStaticPath(root, bad)).toBeUndefined();
  });
});
