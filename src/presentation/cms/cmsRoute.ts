/**
 * @file 店舗CMS のルート（presentation/cms 層）
 * ハッシュは '#/<スポットID>/<ページ>'（例: '#/s_mm04/events'）。店の選択を URL に持たせ、再読み込みしても同じ店・同じページを開く。
 * スポットID は書式だけを検証する（存在は GetCmsShopInfoUseCase が確かめる＝SEC-16）。不正なら店なし・ホーム。
 */
import { createLogger } from '@/Common/logging/logger';
import { parseSpotId } from '@/Common/types/Id';

const logger = createLogger('presentation/cms/cmsRoute');

/** CMS のページ（docs/09 §5 の C02・C03・C04/C05・C07） */
export const CMS_PAGES = ['home', 'info', 'events', 'data'] as const;

/** CMS のページ */
export type CmsPage = (typeof CMS_PAGES)[number];

/** ページの表示名（ページ切り替えの順） */
export const CMS_PAGE_LABELS: Readonly<Record<CmsPage, string>> = {
  home: 'ホーム',
  info: 'お店の情報',
  events: 'クーポン・イベント',
  data: '来店データ',
};

/** スマホ幅で使う短い表示名 */
export const CMS_PAGE_SHORT_LABELS: Readonly<Record<CmsPage, string>> = {
  home: 'ホーム',
  info: 'お店',
  events: 'クーポン',
  data: 'データ',
};

/** CMS のルート */
export interface CmsRoute {
  /** 選んでいる店（書式が正しいときだけ） */
  readonly spotId?: string;
  readonly page: CmsPage;
}

/**
 * ページ名か判定する。
 * @param value 判定する値
 * @returns ページ名なら true
 */
function isCmsPage(value: unknown): value is CmsPage {
  return typeof value === 'string' && (CMS_PAGES as readonly string[]).includes(value);
}

/**
 * ハッシュを CMS のルートにする。
 * @param hash location.hash（例: '#/s_mm04/events'）
 * @returns ルート（不正な部分は捨てる。ページの既定はホーム）
 */
export function parseCmsHash(hash: string): CmsRoute {
  const log = logger.fn('parseCmsHash', { hash });
  const [rawSpot, rawPage] = hash.replace(/^#\/?/, '').split('/');
  const spotId = parseSpotId(rawSpot);
  const page = isCmsPage(rawPage) ? rawPage : 'home';
  return log.exit(spotId.ok ? { spotId: spotId.value, page } : { page });
}

/**
 * CMS のルートをハッシュにする。
 * @param spotId 店のスポットID
 * @param page ページ
 * @returns '#/<スポットID>/<ページ>'
 */
export function cmsHashOf(spotId: string, page: CmsPage): string {
  return `#/${spotId}/${page}`;
}
