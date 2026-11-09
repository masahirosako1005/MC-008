/**
 * @file presentation に渡すサービス一覧（application 層の公開境界）
 * presentation はこの IF だけを通してユースケースを呼ぶ（infrastructure を知らない）。実体は infrastructure/di/container が組み立てる。
 * ユースケースは UseCase<I, O> 形（1操作=1クラス、execute が Result を返す）。旅人はセッションから解決するので入力に travelerId は無い（SEC-01）。
 * docs/08 §4.3。PoC 範囲（docs/08 §8）＋図鑑・マイ街・ランキング・設定（文字の大きさ）。
 */
import type { AppError, Result } from '@/Common/result/Result';
import type {
  AdvanceDateInput,
  AdvanceDateOutput,
  AppStatusDto,
  SaveAvatarInput,
  SaveAvatarOutput,
  DiscoverInput,
  DiscoverOutput,
  AvatarClosetDto,
  MapDataDto,
  MyTownDto,
  MoveDemoPositionInput,
  NearbyInput,
  NearbySpotDto,
  OtherTravelerDto,
  PositionDto,
  RankingDto,
  RankStatusDto,
  RevisitReasonDto,
  SimulateRivalInput,
  SimulateRivalOutput,
  SpotDetailDto,
  SpotDetailInput,
  SwitchTravelerInput,
  SwitchTravelerOutput,
  TownStateDto,
  VisitInput,
  VisitOutput,
  ZukanDto,
  ZukanInput,
} from '@/application/dto/Dto';
import type { DeleteAllDataInput, DeleteAllDataOutput, ExportDataDto, SettingsDto, UpdateTextScaleInput } from '@/application/dto/SettingsDto';
import type { EventSubscriber } from '@/application/events/EventBus';

/** ユースケースの共通形 */
export interface UseCase<I, O, C extends string = string> {
  /** ユースケースを実行する。失敗は Result で返す */
  execute(input: I): Promise<Result<O, AppError<C>>>;
}

/** デモ専用ユースケース（isDemoBuild のときだけ存在する＝SEC-02） */
export interface DemoServices {
  readonly advanceDate: UseCase<AdvanceDateInput, AdvanceDateOutput>;
  readonly simulateRival: UseCase<SimulateRivalInput, SimulateRivalOutput>;
  readonly switchTraveler: UseCase<SwitchTravelerInput, SwitchTravelerOutput>;
  /** 位置を開始地区（南森町・天満宮地区）の入口へ戻す */
  readonly resetPosition: UseCase<void, PositionDto>;
  /** 地図タップ・歩行でデモ位置を動かす */
  readonly moveTo: UseCase<MoveDemoPositionInput, PositionDto>;
  /**
   * 店舗CMS（cms.html）で保存されたとき（スポット・クーポン/イベントが変わったとき）に呼ぶ関数を登録する（docs/09 §7.2）。
   * 戻り値は登録解除の関数。無いときは CMS の反映なし。
   */
  readonly onCatalogChanged?: (listener: () => void) => () => void;
}

/** presentation が受け取るサービス一覧 */
export interface AppServices {
  readonly isDemo: boolean;
  /**
   * 店舗CMS の登録内容が変わったとき（連携サーバーから新しい版が届いたとき・デモで別タブの cms.html が保存したとき）に呼ぶ関数を登録する。
   * 戻り値は登録解除の関数。無いときは CMS の反映なし（docs/09 §7.3）
   */
  readonly onCatalogChanged?: (listener: () => void) => () => void;
  /** ドメインイベントの購読（演出・地図パルス用） */
  readonly events: EventSubscriber;
  readonly status: UseCase<void, AppStatusDto>;
  readonly map: UseCase<void, MapDataDto>;
  readonly position: UseCase<void, PositionDto>;
  readonly discover: UseCase<DiscoverInput, DiscoverOutput>;
  readonly visit: UseCase<VisitInput, VisitOutput>;
  readonly nearby: UseCase<NearbyInput, readonly NearbySpotDto[]>;
  readonly reasons: UseCase<void, readonly RevisitReasonDto[]>;
  readonly spotDetail: UseCase<SpotDetailInput, SpotDetailDto>;
  readonly town: UseCase<void, TownStateDto>;
  /** 図鑑（地区別のタイルと通った回数。達成率は返さない） */
  readonly zukan: UseCase<ZukanInput, ZukanDto>;
  /** ランキング（月間3リーグ＋地区の主） */
  readonly ranking: UseCase<void, RankingDto>;
  /** 地図に出す「ほかの旅人」（模擬ライバル。地区単位）。未提供なら地図にほかの旅人を描かない */
  readonly travelers?: UseCase<void, readonly OtherTravelerDto[]>;
  /** 旅人のまとめ（カード・アイテム・ランク・5地区・アバターの装い。地図の自分のアバターに使う） */
  readonly myTown: UseCase<void, MyTownDto>;
  /** アバター画面（着せ替え）の部品・装い・マイコーデ */
  readonly avatar: UseCase<void, AvatarClosetDto>;
  /** 着せ替えを保存する（持っている部品だけ） */
  readonly saveAvatar: UseCase<SaveAvatarInput, SaveAvatarOutput>;
  /** ランク（旅人ランクの段・ポイントの内訳・最近のポイント・通いの実績。下部タブ「ランク」） */
  readonly rankStatus: UseCase<void, RankStatusDto>;
  /** 端末の設定（文字の大きさ）を読む。未保存なら既定値（標準） */
  readonly settings: UseCase<void, SettingsDto>;
  /** 文字の大きさ（標準／大／特大）を保存する */
  readonly updateTextScale: UseCase<UpdateTextScaleInput, SettingsDto>;
  /** 端末に保存した利用者のデータを JSON に書き出す（DI-21。店舗CMS の登録内容は含めない） */
  readonly exportData: UseCase<void, ExportDataDto>;
  /** 端末に保存した利用者のデータをすべて消す（PRV-05。確認済みのときだけ） */
  readonly deleteAllData: UseCase<DeleteAllDataInput, DeleteAllDataOutput>;
  readonly demo?: DemoServices;
}
