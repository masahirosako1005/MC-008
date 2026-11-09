/**
 * @file 連携サーバーの起動オプションと、画面の配信のパス検証のテスト（infrastructure/server 層・テスト）
 */
import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStaticPath } from '@/infrastructure/server/http/staticFiles';
import { DEFAULT_SERVER_OPTIONS, parseServerArgs } from '@/infrastructure/server/serverOptions';

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
});

describe('resolveStaticPath', () => {
  const root = resolve('dist-backend');
  it('フォルダの中だけを返す（../・\\・NUL・符号化した ../ を拒否＝SEC-16）', () => {
    expect(resolveStaticPath(root, '/')).toBe(resolve(root, 'index.html'));
    expect(resolveStaticPath(root, '/assets/a.js')).toBe(`${root}${sep}assets${sep}a.js`);
    for (const bad of ['/../package.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/a%00.js', '/%E0%A4%A']) expect(resolveStaticPath(root, bad)).toBeUndefined();
  });
});
