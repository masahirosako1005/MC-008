/**
 * @file 地図の「広域／中間／詳細」切替ボタン（presentation/screens/Map 層）
 * 地図の右上に重ねる3択のボタン。3段階ズーム（CLAUDE.md 6.2）にそのまま対応する。
 * - 広域＝市全体（wide）
 * - 中間＝地区全体（district。地区タップで拡大したときと同じ）
 * - 詳細＝現在地のまわり（near）
 * 状態は持たない。押されたら呼び出し側のハンドラを呼び、表示は update で合わせる。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { userAction } from '@/Common/ui/userAction';
import { distanceMeters } from '@/presentation/screens/Map/MapViewModel';
import type { LatLng, MapDistrictVm } from '@/presentation/screens/Map/MapViewModel';
import type { MapZoom } from '@/presentation/screens/Map/ZoomState';

const logger = createLogger('presentation/screens/Map/ZoomToggle');

/** 切替ボタンの値 */
export type ZoomToggleValue = 'wide' | 'middle' | 'detail';

/** 切替ボタンが押されたときの呼び出し先 */
export interface ZoomToggleHandlers {
  /** 「広域」：市全体を表示する */
  readonly onWide: () => void;
  /** 「中間」：地区全体を表示する */
  readonly onMiddle: () => void;
  /** 「詳細」：現在地のまわりを表示する */
  readonly onDetail: () => void;
}

/** 切替ボタンの操作口 */
export interface ZoomToggleHandle {
  readonly element: HTMLElement;
  /**
   * 今のズームに合わせて押下状態を変える。
   * @param zoom 今のズーム段階
   */
  update(zoom: MapZoom): void;
}

/** ボタンの並び（左から）と文言 */
const BUTTONS: readonly { readonly value: ZoomToggleValue; readonly label: string }[] = [
  { value: 'wide', label: '広域' },
  { value: 'middle', label: '中間' },
  { value: 'detail', label: '詳細' },
];

/** ズーム段階 → 切替ボタンの値 */
const VALUE_OF_ZOOM: Readonly<Record<MapZoom, ZoomToggleValue>> = { wide: 'wide', district: 'middle', near: 'detail' };

/**
 * ズーム段階から、切替ボタンのどれを押された状態にするかを返す。
 * @param zoom ズーム段階
 * @returns 'wide'（広域）／'middle'（中間＝地区）／'detail'（詳細＝近接）
 */
export function toggleValueOf(zoom: MapZoom): ZoomToggleValue {
  const log = logger.fn('toggleValueOf', { zoom });
  return log.exit(VALUE_OF_ZOOM[zoom]);
}

/**
 * 「中間」で表示する地区を決める。
 * 優先順: いま注目している地区 → 現在地のある地区 → 現在地にいちばん近い地区（中心の距離）。
 * @param districts 全地区
 * @param focusedId いま注目している地区ID（地区・詳細ズーム中。無ければ undefined）
 * @param position 現在地（不明なら undefined）
 * @param locatedId 現在地のある地区ID（地区外なら undefined）
 * @returns 地区ID（決められなければ undefined）
 */
export function middleDistrictOf(districts: readonly MapDistrictVm[], focusedId: string | undefined, position: LatLng | undefined, locatedId: string | undefined): string | undefined {
  const log = logger.fn('middleDistrictOf', { focusedId, locatedId, hasPosition: position !== undefined });
  if (focusedId !== undefined && districts.some((d) => d.id === focusedId)) return log.exit(focusedId);
  if (locatedId !== undefined) return log.exit(locatedId);
  if (position === undefined) return log.exit(undefined);
  let nearest: MapDistrictVm | undefined;
  for (const d of districts) if (nearest === undefined || distanceMeters(position, d.center) < distanceMeters(position, nearest.center)) nearest = d;
  return log.exit(nearest?.id);
}

/**
 * 「広域／中間／詳細」切替ボタンを作る。
 * @param handlers 押されたときの呼び出し先
 * @returns 要素と表示更新の操作口
 */
export function createZoomToggle(handlers: ZoomToggleHandlers): ZoomToggleHandle {
  const log = logger.fn('createZoomToggle');
  const handlerOf: Readonly<Record<ZoomToggleValue, () => void>> = { wide: handlers.onWide, middle: handlers.onMiddle, detail: handlers.onDetail };
  const buttons = BUTTONS.map(({ value, label }) =>
    h('button', {
      class: 'map-zoom-toggle__btn',
      attrs: { type: 'button', 'aria-pressed': 'false', 'data-testid': `map-zoom-${value}`, 'data-value': value },
      text: label,
      on: { click: userAction(`map-zoom-${value}`, handlerOf[value]) },
    }),
  );
  const element = h('div', { class: 'map-zoom-toggle', attrs: { role: 'group', 'aria-label': '地図の表示範囲', 'data-testid': 'map-zoom-toggle' } }, buttons);
  /**
   * 押下状態を今のズームに合わせる。
   * @param zoom 今のズーム段階
   * @sideEffect ボタンの aria-pressed を書き換える
   */
  const update = (zoom: MapZoom): void => {
    const updateLog = logger.fn('update', { zoom });
    const value = toggleValueOf(zoom);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.value === value));
    updateLog.exit(undefined);
  };
  return log.exit({ element, update });
}
