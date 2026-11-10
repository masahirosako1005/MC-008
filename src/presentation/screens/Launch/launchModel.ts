/**
 * @file 開始画面のモデル（presentation/screens/Launch。DOM・Canvas を使わない純粋関数）
 * アプリを開いたときの開始画面（LaunchScreen）に出す内容を、旅人の状態から組み立てる。文字は最小限（説明文・手順は出さない）。
 * - 空の時間帯（朝・昼・夕・夜）はアプリの時計（ステータスの時刻）から決める
 * - カード: 見出し（WELCOME BACK／WELCOME）・呼び名・3つのステータス（ランク・通った回数・ポイント。数字は数え上げ）・今日の行く理由1件
 * - 街並みは地区ごとの成長 Lv・色あせ・地区の主から描く（育った地区ほど高いビル。未訪問はシルエット、色あせは灰色）
 * 失敗した取得（undefined）は、その部分を出さないか一般的な内容で補う（開始画面で起動を止めない）。
 * 演出の進み具合（イージング）もここに置く。毎フレーム呼ぶ算術はログを出さない。
 */
import { clamp01 } from '@/Common/ui/canvas/easing';
export { clamp01, easeOutBack, easeOutCubic } from '@/Common/ui/canvas/easing';
import type { AppStatusDto, RankStatusDto, RevisitReasonDto, RevisitReasonKindDto, TownStateDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/screens/Launch/launchModel');

/** 空の時間帯 */
export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night';

/** ステータスのアイコン（Common/ui/icons の名前） */
export type LaunchChipIcon = 'rank' | 'footprints' | 'coin';

/** カードのステータス1つ（アイコン＋値。数字は数え上げる） */
export interface LaunchChip {
  readonly icon: LaunchChipIcon;
  /** 読み上げ用の名前（画面には出さない） */
  readonly label: string;
  /** 表示する値（ランク名、または「45回」のような数字と単位） */
  readonly value: string;
  /** 数え上げる数（数字のステータスだけ） */
  readonly count?: number;
  /** 数字の後ろの小さな単位 */
  readonly unit?: string;
}

/** 今日の行く理由（再訪理由のいちばん強い1件） */
export interface LaunchReason {
  readonly kind: RevisitReasonKindDto;
  /** 種別の名前（期限・取り返し・色あせ・未訪問・新着。読み上げ用） */
  readonly label: string;
  readonly title: string;
}

/** 街並みに描く地区 */
export interface LaunchDistrictArt {
  readonly id: string;
  /** 地区色 '#rrggbb' */
  readonly color: string;
  /** 成長段階 0〜3（0 はシルエット） */
  readonly level: 0 | 1 | 2 | 3;
  /** 色あせ中（灰色で描く。Lv は減らない） */
  readonly faded: boolean;
  /** 自分が地区の主（ピンに王冠） */
  readonly isLordMe: boolean;
}

/** 開始画面の内容 */
export interface LaunchModel {
  readonly sky: SkyPhase;
  /** はじめての人（まだ1回も訪問していない） */
  readonly isFirst: boolean;
  /** カードの小さな見出し（WELCOME BACK／WELCOME） */
  readonly eyebrow: string;
  /** 呼び名（はじめての人は「はじめまして」） */
  readonly headline: string;
  readonly chips: readonly LaunchChip[];
  readonly reason?: LaunchReason;
  /** 自分が主をつとめる地区の数 */
  readonly lordCount: number;
  /** はじめるボタンの読み上げ名（2〜4字） */
  readonly cta: string;
  readonly districts: readonly LaunchDistrictArt[];
}

/** 開始画面の入力（どれも取れなければ undefined） */
export interface LaunchInput {
  readonly status?: AppStatusDto;
  readonly rank?: RankStatusDto;
  readonly town?: TownStateDto;
  readonly reasons?: readonly RevisitReasonDto[];
}

/** 再訪理由の種別の名前（CLAUDE.md 4.5 の表と同じ） */
export const REASON_KIND_LABELS: Readonly<Record<RevisitReasonKindDto, string>> = {
  deadline: '期限',
  reclaim: '奪還',
  fade: '色あせ',
  unvisited: '未達成',
  new: '新着',
};

/** 地区が取れないときの街並み（tokens.css の地区色5色。色づいた Lv1 の一般的な街） */
const FALLBACK_COLORS: readonly string[] = ['#8577b8', '#d6a23c', '#6f9e6a', '#cf7186', '#4f93a8'];

/** 街並みに並べる地区の上限（画面幅 390px に5群） */
export const MAX_LAUNCH_DISTRICTS = 5;

/** ニックネームが無いときの呼び名 */
const DEFAULT_NICKNAME = '冒険者';

/**
 * 'H:MM' の時刻表示から時（0〜23）を取り出す。
 * @param label 時刻の表示（例 '9:41'、'21:05'）
 * @returns 時。読めなければ undefined
 */
export function hourOfTimeLabel(label: string | undefined): number | undefined {
  const log = logger.fn('hourOfTimeLabel');
  const m = /^\s*(\d{1,2}):\d{2}/.exec(label ?? '');
  if (m === null) return log.exit(undefined, '時刻を読めない');
  const hour = Number(m[1]);
  return log.exit(hour >= 0 && hour <= 23 ? hour : undefined);
}

/**
 * 時から空の時間帯を決める（朝 5〜7時台・昼 8〜15時台・夕 16〜18時台・夜 それ以外）。
 * @param hour 時（0〜23）。不明なら昼
 * @returns 空の時間帯
 */
export function skyPhaseOf(hour: number | undefined): SkyPhase {
  const log = logger.fn('skyPhaseOf', { hour });
  if (hour === undefined) return log.exit('day');
  if (hour >= 5 && hour < 8) return log.exit('dawn');
  if (hour >= 8 && hour < 16) return log.exit('day');
  if (hour >= 16 && hour < 19) return log.exit('dusk');
  return log.exit('night');
}

/**
 * 地区カードから街並みの地区を作る（並び順はそのまま、最大5地区）。取れないときは一般的な街並み。
 * @param town 町全体の状態
 * @returns 街並みに描く地区
 */
export function launchDistrictsOf(town: TownStateDto | undefined): readonly LaunchDistrictArt[] {
  const log = logger.fn('launchDistrictsOf', { count: town?.districts.length });
  const list = town?.districts ?? [];
  if (list.length === 0) {
    return log.exit(FALLBACK_COLORS.map((color, i) => ({ id: `fallback-${i}`, color, level: 1 as const, faded: false, isLordMe: false })), '一般的な街並み');
  }
  return log.exit(
    list.slice(0, MAX_LAUNCH_DISTRICTS).map((d) => ({
      id: d.id,
      color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : FALLBACK_COLORS[0] ?? '#8577b8',
      level: clampLevel(d.level),
      faded: d.fade.kind === 'fading',
      isLordMe: d.isLordMe,
    })),
  );
}

/**
 * 成長段階を 0〜3 に丸める。
 * @param level 成長段階
 * @returns 0〜3
 */
function clampLevel(level: number): 0 | 1 | 2 | 3 { // audit-ignore: fnlog-missing 地区ごとに呼ぶ純粋な丸め
  if (!Number.isFinite(level) || level <= 0) return 0;
  if (level >= 3) return 3;
  return level < 2 ? 1 : 2;
}

/**
 * ランクから3つのステータス（ランク名・通った回数・ポイント）を作る。
 * @param rank ランク画面の DTO
 * @returns ステータス
 */
function chipsOf(rank: RankStatusDto): readonly LaunchChip[] {
  const log = logger.fn('chipsOf');
  return log.exit([
    { icon: 'rank', label: 'ランク', value: rank.rank.name },
    { icon: 'footprints', label: '通った回数', value: `${rank.totalVisits}回`, count: rank.totalVisits, unit: '回' },
    { icon: 'coin', label: 'EXP', value: `${rank.points}EXP`, count: rank.points, unit: 'EXP' },
  ]);
}

/**
 * 旅人の状態から開始画面の内容を組み立てる。
 * @param input ステータス・ランク・町・再訪理由（取れなかったものは undefined）
 * @returns 開始画面の内容
 */
export function buildLaunchModel(input: LaunchInput): LaunchModel {
  const log = logger.fn('buildLaunchModel', { hasStatus: input.status !== undefined, hasRank: input.rank !== undefined });
  const rank = input.rank;
  const isFirst = rank !== undefined ? rank.totalVisits === 0 : input.status?.travelerProfile === 'first';
  const districts = launchDistrictsOf(input.town);
  const top = input.reasons?.[0];
  return log.exit({
    sky: skyPhaseOf(hourOfTimeLabel(input.status?.timeLabel)),
    isFirst,
    eyebrow: isFirst ? 'WELCOME' : 'WELCOME BACK',
    headline: isFirst ? 'はじめまして' : (rank?.nickname ?? '').trim() || DEFAULT_NICKNAME,
    chips: isFirst || rank === undefined ? [] : chipsOf(rank),
    reason: top === undefined ? undefined : { kind: top.kind, label: REASON_KIND_LABELS[top.kind], title: top.title },
    lordCount: districts.filter((d) => d.isLordMe).length,
    cta: isFirst ? '冒険に出る' : 'クエストへ',
    districts,
  });
}

/** 開始画面を出すか */
export type LaunchMode = 'show' | 'skip';

/**
 * 開始画面を出すかを決める。URL の ?launch=0 で出さない・?launch=1 で必ず出す。
 * 自動操作のブラウザ（navigator.webdriver。画面確認のスクリプトなど）では、操作をふさがないよう既定で出さない。
 * @param env URL の検索部分と自動操作かどうか
 * @returns show / skip
 */
export function launchModeOf(env: { readonly search: string; readonly webdriver: boolean }): LaunchMode {
  const log = logger.fn('launchModeOf', { webdriver: env.webdriver });
  const param = new URLSearchParams(env.search).get('launch');
  if (param === '0') return log.exit('skip', '?launch=0');
  if (param === '1') return log.exit('show', '?launch=1');
  return log.exit(env.webdriver ? 'skip' : 'show');
}

// ---------------------------------------------------------------------------
// 演出の進み具合（毎フレーム呼ぶ純粋な算術。ログは出さない）
// ---------------------------------------------------------------------------

/**
 * 区間の進み具合（開始前 0、終了後 1）。
 * @param t いまの時刻（ms）
 * @param start 開始（ms）
 * @param duration 長さ（ms）
 * @returns 0〜1
 */
export function spanProgress(t: number, start: number, duration: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術
  return duration <= 0 ? (t >= start ? 1 : 0) : clamp01((t - start) / duration);
}

/**
 * 弾むイージング（ピンが落ちて跳ねる）。
 * @param x 0〜1
 * @returns 0〜1
 */
export function easeOutBounce(x: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術
  const n1 = 7.5625;
  const d1 = 2.75;
  let p = clamp01(x);
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) { p -= 1.5 / d1; return n1 * p * p + 0.75; }
  if (p < 2.5 / d1) { p -= 2.25 / d1; return n1 * p * p + 0.9375; }
  p -= 2.625 / d1;
  return n1 * p * p + 0.984375;
}
