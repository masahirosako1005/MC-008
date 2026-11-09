/**
 * @file 店舗CMS の画面が受け取る唯一の入口（application 層。docs/09 §7.2）
 * フェーズ1（デモ）だけで使う。isDemoBuild でなければ cmsContainer が作らない（MUST-8, SEC-02）。
 */
import type { UseCase } from '@/application/AppServices';
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
}
