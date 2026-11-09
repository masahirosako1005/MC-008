/**
 * @file デモ（実演用）ユースケースの固定値（application 層）
 * すべて（仮）。docs/08 §4.4・§4.5・§9.3・D13・D14。本番ビルドでは container がデモユースケースを登録せず、
 * 各ユースケースも isDemoBuild が false なら DEMO_DISABLED で拒否する（SEC-02）。
 * ID は文字列で持ち、使う側で parseXxx を通してブランド型にする（SEC-16）。
 */

/** デモの旅人ID（初回の人）（仮） */
export const DEMO_FIRST_TRAVELER_ID_TEXT = 't_demofirst';

/** デモの旅人ID（通い慣れた人）（仮） */
export const DEMO_REGULAR_TRAVELER_ID_TEXT = 't_demoregular';

/** デモの旅人の表示名（初回の人）（仮） */
export const DEMO_FIRST_NICKNAME = '初回の人';

/** デモの旅人の表示名（通い慣れた人）（仮） */
export const DEMO_REGULAR_NICKNAME = '通い慣れた人';

/** 位置リセット・旅人切替で戻る地区（南森町・天満宮地区。入口＝南森町駅付近へ移動する。旧 N西市の城下地区の役割＝docs/08 §9.1）（仮） */
export const DEMO_START_DISTRICT_ID_TEXT = 'd_minamimori';

/** デモ位置の測位精度（m。infrastructure/geo/DemoGeoProvider の DEMO_ACCURACY_M と同じ値）（仮） */
export const DEMO_POSITION_ACCURACY_M = 5;

/** 日付進行で選べる日数（CLAUDE.md 6.9: +1日／+30日／+90日） */
export const DEMO_ADVANCE_DAYS: readonly number[] = [1, 30, 90];

/** ライバル行動の既定のライバル（旅人タロウ）（仮） */
export const DEMO_DEFAULT_RIVAL_ID_TEXT = 'r_taro';

/** ライバル行動の既定の地区（天満地区。背景活動が無いので主交代が確実に起きる＝D9。旧 本町地区の役割＝docs/08 §9.1）（仮） */
export const DEMO_DEFAULT_RIVAL_DISTRICT_ID_TEXT = 'd_tenma';

/** シードの訪問の操作ID の接頭辞（後ろに 12 桁 16 進の連番を付ける） */
export const DEMO_SEED_OPERATION_ID_PREFIX = '00000000-0000-4000-8000-';

/** シードの操作ID の連番の桁数（16 進） */
export const DEMO_SEED_OPERATION_ID_DIGITS = 12;

/** シードの訪問の時刻（JST の時。同じ日の2件目以降は1時間ずつ後ろにずらす） */
export const DEMO_SEED_FIRST_VISIT_HOUR = 10;

/** シードの「発見のみ」のスポットを発見した時刻（JST の時。その日の訪問より前） */
export const DEMO_SEED_DISCOVERY_HOUR = 9;

/** シードの訪問の距離（m）と測位精度（m）。デモの作り物なので距離 0・精度はデモ位置と同じ */
export const DEMO_SEED_VISIT_METERS = 0;
