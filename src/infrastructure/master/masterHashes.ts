/**
 * @file マスタデータの SHA-256 ハッシュ（infrastructure 層・自動生成。手で編集しない）
 * scripts/master/hash-master.mjs（npm run master:hash）が public/master/*.json のバイト列から生成する。
 * MasterDataLoader が fetch した本文の SHA-256（crypto.subtle.digest）と照合し、一致しないマスタは読み込まない（SEC-22, DI-13）。
 */

/** マスタファイル名 → 本文の SHA-256（16進・小文字） */
export const MASTER_HASHES: Readonly<Record<string, string>> = Object.freeze({
  'districts.json': '22d0066f7c85318b55c016b6a7610d0508b9ad9f4a7ccd8f9e9d1040accb6eee',
  'landmarks.json': 'ad118508d5edc0e51c4fccda33f2c2665f91914a4e28114def6c1c3574eacfce',
  'shops.json': '24df93ca48f9203a2bb31b24125075ef2a26cafb7b93862fbab457653278687f',
  'shopEvents.json': '38fb5aeeb4beb6b19184aac645572dc74063fe94524a0cda2d7186d24665888e',
  'rivals.json': '0cee408656ce851e0ca81dc61d7870df9ad87ab3ea8725b20b4889ea6fb16191',
  'mapFeatures.json': '9e1961f45126dde2d28e9fd38a9529bcef6c6285b80245bf67820e28d7e1510b',
  'amenityPoints.json': 'c3bb6bce7dda7230b90250fcadc70989f7e2382b04650e826fc476755601aa9e',
});
