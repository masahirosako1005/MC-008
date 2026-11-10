/**
 * @file 連携サーバーの API の道筋と応答の形（infrastructure/api 層。サーバーとブラウザで共有する契約。docs/09 §7.3）
 * 道筋・ヘッダー名・SSE のイベント名をここ1か所で決め、サーバー（infrastructure/server）と
 * ブラウザ側の呼び出し（HttpCmsServices・CmsSnapshotSync）が同じ定数を使う（食い違いを作らない）。
 *
 * | 道筋 | 用途 | 使える版 |
 * |---|---|---|
 * | GET  /api/health | 動作確認（版番号・モード） | 両方 |
 * | GET  /api/public/cms-snapshot | 公開スナップショット（利用者アプリが読む。ETag つき） | 両方 |
 * | GET  /api/public/cms-snapshot/stream | 版番号の変化を SSE で知らせる | 両方 |
 * | GET  /api/cms/shops | 店舗の一覧 | デモだけ |
 * | GET  /api/cms/shops/:spotId | 店舗の情報とクーポン・イベント | デモだけ |
 * | PUT  /api/cms/shops/:spotId/info | 営業時間・便利情報の保存 | デモだけ |
 * | POST /api/cms/shops/:spotId/events | クーポン・イベントの登録 | デモだけ |
 * | POST /api/cms/shops/:spotId/events/:eventId/withdraw | 取り下げ | デモだけ |
 * | GET  /api/cms/shops/:spotId/visit-stats | 来店データ（ダミー） | デモだけ |
 * | GET  /api/cms/shops/:spotId/survey | アンケートの集計（サンプル。アプリの回答はまだ届かない） | ログイン |
 * | POST /api/cms/demo/reset | 登録内容をすべて消す | デモだけ |
 */

/** API の道筋の先頭 */
export const API_PREFIX = '/api/';

/** 固定の道筋 */
export const API_PATHS = Object.freeze({
  health: '/api/health',
  publicSnapshot: '/api/public/cms-snapshot',
  publicSnapshotStream: '/api/public/cms-snapshot/stream',
  cmsShops: '/api/cms/shops',
  cmsDemoReset: '/api/cms/demo/reset',
});

/** 店舗の下の道筋 */
export type CmsShopSubPath = 'info' | 'events' | 'visit-stats' | 'survey';

/** デモの日付進行（ずらし日数）をサーバーへ伝えるヘッダー（デモのサーバーだけが読む） */
export const DEMO_OFFSET_HEADER = 'x-demo-offset-days';

/** SSE で版番号の変化を知らせるイベント名 */
export const SNAPSHOT_STREAM_EVENT = 'snapshot';

/** 失敗の応答に入れる補足（文字・数値・真偽だけ。内部情報は入れない） */
export type ApiErrorDetails = Readonly<Record<string, string | number | boolean>>;

/** 応答の封筒（CMS の API）。成功は value、失敗は error を持つ */
export type ApiEnvelope<T> =
  | { readonly ok: true; readonly value?: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: ApiErrorDetails } };

/**
 * 店舗の道筋を作る（ID は URL 用に符号化する。中身の検証はサーバーが行う）。
 * @param spotId スポットID
 * @param sub 下の道筋（省略時は店舗そのもの）
 * @returns 例: '/api/cms/shops/s_tm01/events'
 */
export function cmsShopPath(spotId: string, sub?: CmsShopSubPath): string { // audit-ignore: fnlog-missing 道筋の文字列を組み立てるだけの純粋なヘルパー（呼び出し元の execute で記録する）
  const base = `${API_PATHS.cmsShops}/${encodeURIComponent(spotId)}`;
  return sub === undefined ? base : `${base}/${sub}`;
}

/**
 * 取り下げの道筋を作る。
 * @param spotId スポットID
 * @param shopEventId クーポン・イベントの ID
 * @returns 例: '/api/cms/shops/s_tm01/events/c_xxxx/withdraw'
 */
export function cmsWithdrawPath(spotId: string, shopEventId: string): string {
  return `${cmsShopPath(spotId, 'events')}/${encodeURIComponent(shopEventId)}/withdraw`;
}
