/**
 * @file Canvas 用のカラーパレット（Common/ui/theme 層。定数のみ）
 * CSS のデザイントークン（src/Common/ui/styles/tokens.css）と同じ色を Canvas から使うための1か所の定数。
 * コンセプト「紙の上に育つ、ミニチュアの街」：温かい地図の地（ベージュ）・水彩の地区色・落ち着いたオレンジのブランド色・温かい墨色の文字。
 * 色を変えるときは tokens.css と揃える。地区色そのものはマスタ（districts.json）の color を使い、ここでは淡色・影色の作り方だけを持つ。
 * Canvas でも、UI の役割の色（ブランド・状態・金属・夜の盤・紙吹雪）はここから取る。絵の部品の色（屋根・服・木など）は各絵のファイルの色表でよい（docs/10_color_system.md）。
 */

/** アプリ全体の基本色（tokens.css と同じ値） */
export const PALETTE = {
  /** ブランド主色（落ち着いたオレンジ。2026-11-10 に青系から変更）。現在地・主要操作 */
  brand: '#bc5b1b',
  /** 白地の文字・濃い塗り用の濃いオレンジ */
  brandInk: '#a54c14',
  brandSoft: '#fbeee0',
  /** ブランドの段（tokens.css の --brand-300 / -400 / -700 / -900） */
  brandLight: '#e8a973',
  brandBright: '#d98244',
  brandDeep: '#863c10',
  brandNight: '#4f240b',
  /** ゲームの光の差し色（--glow） */
  glow: '#ffcf8a',
  /** 夜の盤（--night-950 / -900 / -800 / -700） */
  night950: '#140d08',
  night900: '#20150e',
  night800: '#2d1f15',
  night700: '#402d1e',
  /** 状態の色（--success / --warning / --danger） */
  success: '#3c9d6e',
  warning: '#e0a32a',
  danger: '#cf3a52',
  /** 金属の段（--metal-*。銅 → 銀 → 金 → 白金 → 伝説） */
  metalBronze: '#c98e63',
  metalSilver: '#d0cdc8',
  metalSilverLight: '#f5f3ef',
  metalSilverEdge: '#66615a',
  metalSilverInk: '#2a211b',
  metalGold: '#e2ab2e',
  metalGoldLight: '#f6e2a6',
  metalGoldEdge: '#94640f',
  metalGoldInk: '#4a3500',
  metalPlatinum: '#8fcfc9',
  metalLegend: '#c39ae0',
  /** 紙吹雪・きらめき（演出で共通。ブランド・金・白金・伝説・白） */
  confetti: ['#bc5b1b', '#e2ab2e', '#8fcfc9', '#c39ae0', '#ffffff'],
  /** 文字色（温かい墨色） */
  ink: '#2a211b',
  subInk: '#4a4038',
  mutedInk: '#74695d',
  white: '#ffffff',
  /** 地図の地（ベージュ） */
  paper: '#f6f0e6',
  paperDeep: '#efe7da',
  /** 紙の繊維・しみ（ごく薄い点） */
  paperFiber: '#f1eadf',
  /** 地図の地面（芝・土の淡色） */
  meadow: '#f6f0e6',
  meadowDeep: '#efe7da',
  /** 海 */
  sea: '#b5d6dc',
  seaDeep: '#8fbfc9',
  seaFoam: '#ffffff',
  /** 霧・遠い山（Lv0 の里山） */
  mist: '#f3eee6',
  mountainFar: '#ebe4d8',
  mountainNear: '#d9cfc0',
  /** 影（紙に落ちる柔らかい影） */
  shadow: 'rgba(42, 33, 27, 0.16)',
  shadowSoft: 'rgba(42, 33, 27, 0.08)',
  /** 家の壁（クリーム） */
  wall: '#ffffff',
  wallShade: '#ebe4d8',
  /** 木 */
  tree: '#5fb07a',
  treeDark: '#3f8a58',
  trunk: '#a08a74',
  /** 灯り（Lv3） */
  lamp: '#ffd166',
  lampGlow: 'rgba(255, 209, 102, 0.35)',
  /** 地区の主・金 */
  gold: '#e2ab2e',
  goldDeep: '#b57a10',
  goldInk: '#92400e',
  /** 色あせ（セピア） */
  sepia: '#a89e92',
  sepiaInk: '#74695d',
  /** 未発見・発見済み */
  unknown: '#a89e92',
  discovered: '#74695d',
  /** 期限・クーポン */
  deadline: '#cf3a52',
  /** 地図ベースマップ（docs/08 §10.2。地図アプリ風の淡色） */
  land: '#f6f0e6',
  block: '#efe7da',
  park: '#d5e6cf',
  shrine: '#f7e3dc',
  campus: '#ebe5da',
  water: '#b5d6dc',
  waterInk: '#3f7f8f',
  road: '#ffffff',
  roadCasing: '#e0d8ca',
  arterialCasing: '#d5cbbb',
  arcade: '#ffe3d9',
  rail: '#a89e92',
  station: '#4a4038',
} as const;

/** SVG の見出し文字に使うフォント（tokens.css の --font-seed と同じ並び。drawUtils.ts の CANVAS_FONT_FAMILY と同じ値） */
export const DISPLAY_FONT_FAMILY = '"LINE Seed JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';
