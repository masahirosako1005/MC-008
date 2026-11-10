/**
 * @file ビルドした画面（アプリと CMS）を配る（infrastructure/server/http 層。1つのオリジンで画面と API を配るため）
 * 発表では、PC の CMS とスマホのアプリを同じ連携サーバーにつなぐ。画面と API を同じオリジンにすると、
 * CSP の connect-src 'self' のまま API を呼べる（SEC-04、SEC-07）。
 * 決めたフォルダの外は読まない（パスの書き換え・../ を拒否＝SEC-16）。ヘッダーは vite preview と同じ（SEC-29）。
 */
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('infrastructure/server/http/staticFiles');

/**
 * 画面に付けるヘッダー（vite.config.ts の SECURITY_HEADERS と同じ。SEC-04, SEC-29）。
 * ただし font-src に data: を足す：ビルドが小さなフォント（@fontsource の一部）を data: URI で CSS に埋め込むため。
 * 'self' だけだと、それらのフォントが読み込めずコンソールにエラーが出る（vite preview の設定も同じ食い違いがある）。
 */
const PAGE_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  // ほかのオリジンの窓から、この画面の窓を操作・読み込みできないようにする（CMS から開いたアプリの窓が CMS の窓を別の画面へ動かせない）
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

/** 拡張子 → Content-Type（ここに無いものは配らない） */
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
});

/** 画面を配る関数（配ったら true、無ければ false） */
export type StaticHandler = (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<boolean>;

/**
 * URL のパスを、フォルダの中のファイルの場所にする。
 * @param root フォルダ（絶対パス）
 * @param pathname URL のパス（例 '/assets/main.js'）
 * @returns ファイルの場所（フォルダの外・不正な文字なら undefined）
 */
export function resolveStaticPath(root: string, pathname: string): string | undefined {
  const log = logger.fn('resolveStaticPath');
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    log.warn('URL のパスを読めません');
    return log.exit(undefined);
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return log.exit(undefined, 'badChar');
  const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '');
  const full = resolve(root, relative);
  return log.exit(full.startsWith(root + sep) ? full : undefined);
}

/**
 * フォルダの画面を配る関数を作る。
 * @param rootDir フォルダ（例 'dist-backend'）
 * @returns 画面を配る関数
 */
export function createStaticHandler(rootDir: string): StaticHandler {
  const root = resolve(rootDir);
  return async (req, res, pathname) => {
    const log = logger.fn('serveStatic', { pathname });
    if (req.method !== 'GET' && req.method !== 'HEAD') return log.exit(false, 'method');
    const file = resolveStaticPath(root, pathname);
    const type = file === undefined ? undefined : CONTENT_TYPES[extname(file).toLowerCase()];
    if (file === undefined || type === undefined) return log.exit(false, 'notAllowed');
    try {
      if (!(await stat(file)).isFile()) return log.exit(false, 'notFile');
      const body = await readFile(file);
      const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { ...PAGE_SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': cache, 'Content-Length': String(body.length) });
      res.end(req.method === 'HEAD' ? undefined : body);
      return log.exit(true);
    } catch {
      return log.exit(false, 'notFound');
    }
  };
}
