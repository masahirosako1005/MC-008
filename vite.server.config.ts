/**
 * @file 連携サーバー（src/serverMain.ts）を Node 用の1ファイルにまとめる Vite 設定（docs/09 §7.3）
 * 利用者アプリと同じ src（domain・application・検証の関数）を、@/ の別名ごとそのまままとめる。
 * 依存パッケージは使わない（node:http・node:sqlite などの組み込みだけ。U1 の決定）。sourcemap は出さない（SEC-06）。
 * 使い方：vite build -c vite.server.config.ts --mode demo（→ dist-server/serverMain.mjs）
 *   --mode demo でビルドすると店舗CMS の API を出す。モードを付けない（本番）と公開スナップショットを配るだけ。
 */
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  publicDir: false,
  build: {
    ssr: fileURLToPath(new URL('./src/serverMain.ts', import.meta.url)),
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: false,
    rollupOptions: { output: { entryFileNames: 'serverMain.mjs', format: 'es' } },
  },
  ssr: { noExternal: true, target: 'node' },
});
