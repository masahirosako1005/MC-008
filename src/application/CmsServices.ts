/**
 * @file 店舗CMS の画面が受け取る唯一の入口（application 層。docs/09 §7.2・§7.3）
 * ブラウザだけの CMS（フェーズ1）はデモの版だけ。連携サーバーにつなぐとき（VITE_CMS_BACKEND=server）は本番の版でも使え、
 * ログイン・アカウント（auth）がつく（docs/09 CMS-A04〜A07）。
 */
import type { UseCase } from '@/application/AppServices';
import type { CmsAuthServices } from '@/application/CmsAuthServices';
import type {
  CmsShopInfoDto,
  CmsShopInput,
  CmsShopSummaryDto,
  CmsVisitStatsDto,
  RegisterShopEventInput,
  SaveShopInfoInput,
  WithdrawShopEventInput,
} from '@/application/dto/CmsDto';

/** 店舗CMS のサービス一覧 */
export interface CmsServices {
  /** 店舗の一覧（地区順・名前順） */
  readonly shops: UseCase<void, readonly CmsShopSummaryDto[]>;
  /** 店舗の情報とクーポン・イベント */
  readonly shopInfo: UseCase<CmsShopInput, CmsShopInfoDto>;
  /** 営業時間・便利情報を保存する（すぐ公開＝docs/09 CMS-S09） */
  readonly saveShopInfo: UseCase<SaveShopInfoInput, CmsShopInfoDto>;
  /** クーポン・イベントを登録する（協力店だけ） */
  readonly registerShopEvent: UseCase<RegisterShopEventInput, CmsShopInfoDto>;
  /** CMS で登録したクーポン・イベントを取り下げる */
  readonly withdrawShopEvent: UseCase<WithdrawShopEventInput, CmsShopInfoDto>;
  /** 来訪データ（フェーズ1はダミー） */
  readonly visitStats: UseCase<CmsShopInput, CmsVisitStatsDto>;
  /** CMS の登録内容をすべて消す（デモのやり直し） */
  readonly resetDemo: UseCase<void, void>;
  /** ログインとアカウント（連携サーバーにつなぐときだけ。ブラウザだけの CMS には無い） */
  readonly auth?: CmsAuthServices;
}
