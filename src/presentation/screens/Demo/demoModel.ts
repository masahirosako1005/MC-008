/**
 * @file デモメニューの表示用の純粋関数と既定値（presentation/screens/Demo 層）
 * 日付の表示・ライバル行動の文言・旅人切替の表示名・地図の UI 状態のリセットを DOM から切り離す。
 * デモ専用（isDemoBuild のときだけ #/demo が登録される＝SEC-02）。
 */
import type { AppStatusDto, SimulateRivalOutput } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { formatJpDate, parseLocalDate } from '@/Common/utils/date';
import type { MapUiState } from '@/presentation/App/AppContext';

const logger = createLogger('presentation/screens/Demo/demoModel');

/** 日付進行の選択肢（docs/08 §4.4） */
export const ADVANCE_DAYS = [1, 30, 90] as const;

/** 日付進行の日数 */
export type AdvanceDays = (typeof ADVANCE_DAYS)[number];

/** ライバル行動の既定のライバル（docs/08 §4.4） */
export const DEFAULT_RIVAL_ID = 'r_taro';

/** 既定のライバルの名前（ボタン文言用。結果のトーストは application が返す名前を使う） */
export const DEFAULT_RIVAL_NAME = 'おまいり番長';

/** ライバル行動の既定の地区（天満。背景活動のライバルがいないので手順5で主が確実に交代する＝D9、docs/08 §9.3） */
export const DEFAULT_RIVAL_DISTRICT_ID = 'd_tenma';

/** 既定の地区の表示名（地区一覧を読めなかったときに使う） */
export const DEFAULT_RIVAL_DISTRICT_NAME = '天満地区';

/** 位置リセットで戻る地区（開始地区。入口＝南森町駅付近＝docs/08 §9.3） */
export const RESET_POSITION_DISTRICT_ID = 'd_minamimori';

/** 位置リセットで戻る場所の名前（ボタン文言用） */
export const RESET_POSITION_PLACE = '南森町駅';

/** 位置リセットで戻る地区の表示名（地区一覧を読めなかったときに使う） */
export const RESET_POSITION_DISTRICT_NAME = '南森町・天満宮地区';

/** 旅人切替の選択肢 */
export const TRAVELER_PROFILES = ['first', 'regular'] as const;

/** 旅人の種類（デモ） */
export type DemoTravelerProfile = (typeof TRAVELER_PROFILES)[number];

/** 旅人の種類の表示名 */
export const TRAVELER_PROFILE_LABELS: Readonly<Record<AppStatusDto['travelerProfile'], string>> = {
  first: '初回の人',
  regular: '通い慣れた人',
  user: '利用者',
};

/** ライバル行動で選べる地区 */
export interface RivalDistrictOption {
  readonly id: string;
  readonly name: string;
}

/**
 * デモ日付（'YYYY-MM-DD'）を表示用にする。
 * @param today 日付文字列
 * @returns '2026/12/09（水）'。形式外ならそのまま
 */
export function formatDemoDate(today: string): string {
  const log = logger.fn('formatDemoDate', { today });
  const parsed = parseLocalDate(today);
  return log.exit(parsed.ok ? formatJpDate(parsed.value) : today);
}

/**
 * ライバル行動ボタンの文言。
 * @param districtName 地区名
 * @returns 'おまいり番長が天満地区の主を奪う'
 */
export function rivalButtonLabel(districtName: string): string {
  return `${DEFAULT_RIVAL_NAME}が${districtName}の主を奪う`;
}

/**
 * ライバル行動の結果のトースト文言。
 * @param output ライバル行動の結果
 * @returns 交代したら 'おまいり番長が天満地区の主になりました'、しなければ訪問した旨
 */
export function rivalResultMessage(output: SimulateRivalOutput): string {
  const log = logger.fn('rivalResultMessage', { districtId: output.districtId, changed: output.changed });
  if (output.changed) return log.exit(`${output.rivalName}が${output.districtName}の主になりました`);
  return log.exit(`${output.rivalName}が${output.districtName}を訪れました（主は変わりません）`);
}

/**
 * ライバル行動で選べる地区の一覧（読めなければ既定の天満地区だけ）。
 * @param districts 地区（ID と名前）
 * @returns 選択肢
 */
export function rivalDistrictOptions(districts: readonly RivalDistrictOption[]): RivalDistrictOption[] {
  const log = logger.fn('rivalDistrictOptions', { count: districts.length });
  if (districts.length === 0) return log.exit([{ id: DEFAULT_RIVAL_DISTRICT_ID, name: DEFAULT_RIVAL_DISTRICT_NAME }]);
  return log.exit(districts.map((d) => ({ id: d.id, name: d.name })));
}

/** 位置リセットの文言 */
export interface ResetPositionTexts {
  /** ボタン（例 '位置リセット（南森町駅へ）'） */
  readonly button: string;
  /** 完了のトースト */
  readonly done: string;
  /** パネルの補足 */
  readonly hint: string;
}

/**
 * 位置リセットの文言を作る（地区名は町の状態から取れればそれを使う）。
 * @param districts 地区（ID と名前。読めなければ空）
 * @returns ボタン・トースト・補足の文言
 */
export function resetPositionTexts(districts: readonly RivalDistrictOption[]): ResetPositionTexts {
  const log = logger.fn('resetPositionTexts', { count: districts.length });
  const name = districts.find((d) => d.id === RESET_POSITION_DISTRICT_ID)?.name ?? RESET_POSITION_DISTRICT_NAME;
  const place = `${RESET_POSITION_PLACE}（${name}の入口）`;
  return log.exit({
    button: `位置リセット（${RESET_POSITION_PLACE}へ）`,
    done: `${place}に戻りました`,
    hint: `${place}に戻ります。実演を最初からやり直すときに使います（足あとも消えます）`,
  });
}

/**
 * 地区ID から選択肢の名前を引く（無ければ ID をそのまま）。
 * @param options 選択肢
 * @param districtId 地区ID
 * @returns 地区名
 */
export function districtNameOf(options: readonly RivalDistrictOption[], districtId: string): string {
  return options.find((o) => o.id === districtId)?.name ?? districtId;
}

/**
 * 旅人を切り替えたあと、地図の UI 状態を初期化する（広域・足あと無し・パルス無し・シートはつまみ）。
 * @param ui アプリ単位の地図 UI 状態
 * @sideEffect ui を書き換える
 */
export function resetMapUi(ui: MapUiState): void {
  const log = logger.fn('resetMapUi', { zoom: ui.zoom, footprints: ui.footprints.length });
  ui.zoom = 'wide';
  ui.districtId = undefined;
  ui.footprints = [];
  ui.pulseDistrictId = undefined;
  ui.sheetState = 'peek';
  log.exit(undefined);
}
