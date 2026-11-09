/**
 * @file 画面に渡す共通コンテキスト（presentation/App 層）
 * サービス・ルーター・トースト・演出・地図の UI 状態を1つにまとめ、各画面のファクトリに渡す（docs/08 §6）。
 * ui はアプリ単位の可変オブジェクト。App が1つ作って渡す（グローバル変数にしない＝docs/01 §3-7）。
 */
import type { AppServices } from '@/application/AppServices';
import type { ToastHost } from '@/Common/ui/Toast';
import type { AppRouter } from '@/presentation/App/AppRouter';

/** 訪問操作中に届いたイベントのまとめ（演出の後で地図・トーストに使う） */
export interface EffectSummary {
  /** 今回の訪問で加算された基本ポイント */
  readonly points: number;
  /** 今回の訪問で加算されたおかえりボーナス */
  readonly bonusPoints: number;
  /** 成長段階が上がった地区（地図のパルス・トースト用） */
  readonly grownDistrictIds: readonly string[];
}

/**
 * 全画面演出の再生役（EffectHost）。
 * 訪問の直前に beginCapture() でイベントをため始め、訪問完了後に flush() で
 * 復活（おかえり込み）→ カード → 主交代（自分が主になったときのみ）→ アイテム の順に再生する（docs/08 §6）。
 */
export interface EffectPlayer {
  /** イベントのため込みを始める */
  beginCapture(): void;
  /** ためたイベントを演出として再生し、終わったらまとめを返す */
  flush(): Promise<EffectSummary>;
}

/** 地図まわりの UI 状態（画面をまたいで保つ。位置座標はメモリのみ＝D15、ログに出さない） */
export interface MapUiState {
  /** ズーム段階（広域・地区・近接） */
  zoom: 'wide' | 'district' | 'near';
  /** 地区ズーム中の地区ID */
  districtId?: string;
  /** 足あと（描画専用。保存しない） */
  footprints: { lat: number; lng: number }[];
  /** 成長などでパルス表示したい地区ID */
  pulseDistrictId?: string;
  /** 下シートの段階 */
  sheetState: 'peek' | 'half' | 'full';
  /** 地図のカメラ（ドラッグ・拡大縮小した位置を画面をまたいで保つ。メモリのみ） */
  camera?: { centerLat: number; centerLng: number; metersPerPx: number };
}

/** 画面ファクトリに渡すコンテキスト */
export interface AppContext {
  readonly services: AppServices;
  readonly router: AppRouter;
  readonly toast: ToastHost;
  readonly effects: EffectPlayer;
  /** 地図の UI 状態（App が1つ作る可変オブジェクト） */
  readonly ui: MapUiState;
  /** ステータスバー（日付・デモ表示）を最新にする。日付進行・旅人切替の後に呼ぶ */
  refreshStatus(): Promise<void>;
}
