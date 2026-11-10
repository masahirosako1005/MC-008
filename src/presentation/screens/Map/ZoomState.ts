/**
 * @file 地図のズーム段階の遷移規則（presentation/screens/Map 層。純粋関数）
 * 広域（wide）→ 地区（district）→ 近接（near）は同じ地図画面の状態で、別ルートにしない（docs/02 §2、CLAUDE.md 6.2）。
 * 状態の保存先は AppContext.ui（画面をまたいで保つ）。ここは「次の状態」を決めるだけで副作用を持たない。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/screens/Map/ZoomState');

/** ズーム段階（広域・地区・近接） */
export type MapZoom = 'wide' | 'district' | 'near';

/** ズーム状態。district / near のときは注目している地区ID を持つ（near は現在地の地区。地区外なら無し） */
export interface ZoomState {
  readonly zoom: MapZoom;
  readonly districtId?: string;
}

/** ズーム状態を変える操作 */
export type ZoomAction =
  /** 地区を選んだ（広域で地区タップ・下シートの地区カード） */
  | { readonly type: 'selectDistrict'; readonly districtId: string }
  /** 地図タップで歩き始めた（近接へ）。districtId は目的地の地区 */
  | { readonly type: 'walk'; readonly districtId?: string }
  /** 「広域／詳細」切替で「詳細」を押した（現在地のまわり＝近接へ）。districtId は現在地の地区 */
  | { readonly type: 'detail'; readonly districtId?: string }
  /** 近接表示中に現在地の地区が変わった（地区外なら undefined のまま前の地区を保つ） */
  | { readonly type: 'locate'; readonly districtId?: string }
  /** 上部バーの戻る（近接→地区→広域） */
  | { readonly type: 'back' }
  /** 広域に戻す */
  | { readonly type: 'reset' };

/** 広域の状態 */
export const WIDE_ZOOM: ZoomState = { zoom: 'wide' };

/**
 * 操作に応じた次のズーム状態を返す。
 * - selectDistrict: どこからでも地区ズームへ
 * - walk / detail: 近接へ（目的地・現在地の地区が分かればその地区、分からなければ今の地区を保つ）
 * - locate: 近接表示中だけ地区を更新（地区外に出たときは前の地区を保つ）
 * - back: 近接→地区（地区が無ければ広域）、地区→広域、広域→広域
 * - reset: 広域へ
 * @param state 今のズーム状態
 * @param action 操作
 * @returns 次のズーム状態（変化がなければ同じオブジェクト）
 */
export function nextZoomState(state: ZoomState, action: ZoomAction): ZoomState {
  const log = logger.fn('nextZoomState', { zoom: state.zoom, action: action.type });
  switch (action.type) {
    case 'selectDistrict':
      return log.exit({ zoom: 'district', districtId: action.districtId });
    case 'walk':
    case 'detail':
      return log.exit(withDistrict('near', action.districtId ?? state.districtId));
    case 'locate':
      if (state.zoom !== 'near' || action.districtId === undefined || action.districtId === state.districtId) return log.exit(state);
      return log.exit({ zoom: 'near', districtId: action.districtId });
    case 'back':
      return log.exit(backOf(state));
    case 'reset':
      return log.exit(WIDE_ZOOM);
  }
}

/**
 * 戻る操作の行き先を返す。
 * @param state 今のズーム状態
 * @returns 近接→地区（地区が無ければ広域）、地区→広域、広域→広域
 */
function backOf(state: ZoomState): ZoomState {
  return state.zoom === 'near' && state.districtId !== undefined ? { zoom: 'district', districtId: state.districtId } : WIDE_ZOOM;
}

/**
 * ズーム段階と地区ID からズーム状態を作る（地区ID が undefined のときはキーを持たない）。
 * @param zoom ズーム段階
 * @param districtId 地区ID
 * @returns ズーム状態
 */
function withDistrict(zoom: MapZoom, districtId: string | undefined): ZoomState {
  return districtId === undefined ? { zoom } : { zoom, districtId };
}

/**
 * 上部バーの戻るボタンの文言を返す。
 * @param state 今のズーム状態
 * @returns 近接（地区あり）は '地区全体'、地区・近接（地区なし）は '市全体'、広域は undefined（戻るボタンなし）
 */
export function backLabelOf(state: ZoomState): string | undefined {
  const log = logger.fn('backLabelOf', { zoom: state.zoom });
  if (state.zoom === 'wide') return log.exit(undefined);
  return log.exit(state.zoom === 'near' && state.districtId !== undefined ? '地区全体' : '市全体');
}

/**
 * 画面を開いたときのズーム状態を決める。
 * ルートに地区ID があれば地区ズーム（ただし同じ地区の近接を表示中だったなら近接を保つ）。無ければ保存済みの状態を復元する。
 * 地区ズームなのに地区ID が無いといった不整合は広域に直す。
 * @param routeDistrictId ルート '#/map/:districtId' の地区ID（検証済み。無ければ undefined）
 * @param saved AppContext.ui に保存されている状態
 * @returns 開くときのズーム状態
 */
export function initialZoomState(routeDistrictId: string | undefined, saved: ZoomState): ZoomState {
  const log = logger.fn('initialZoomState', { routeDistrictId, zoom: saved.zoom, districtId: saved.districtId });
  if (routeDistrictId !== undefined) {
    if (saved.zoom === 'near' && saved.districtId === routeDistrictId) return log.exit({ zoom: 'near', districtId: routeDistrictId });
    return log.exit({ zoom: 'district', districtId: routeDistrictId });
  }
  if (saved.zoom === 'district') return log.exit(saved.districtId === undefined ? WIDE_ZOOM : { zoom: 'district', districtId: saved.districtId });
  if (saved.zoom === 'near') return log.exit(withDistrict('near', saved.districtId));
  return log.exit(WIDE_ZOOM);
}

/**
 * このズームで店舗を描くか（広域は地区名と名所だけ。店舗は隠す＝CLAUDE.md 6.2）。
 * @param zoom ズーム段階
 * @returns 地区・近接なら true
 */
export function showsShops(zoom: MapZoom): boolean {
  return zoom !== 'wide';
}
