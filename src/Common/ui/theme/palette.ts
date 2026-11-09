/**
 * @file Canvas 用のカラーパレット（Common/ui/theme 層。定数のみ）
 * CSS のデザイントークン（src/Common/ui/styles/tokens.css）と同じ色を Canvas から使うための1か所の定数。
 * コンセプト「紙の上に育つ、ミニチュアの街」：温かい地図の地（クールグレー）・水彩の地区色・ロイヤルブルーのブランド色・濃いグレーの文字。
 * 色を変えるときは tokens.css と揃える。地区色そのものはマスタ（districts.json）の color を使い、ここでは淡色・影色の作り方だけを持つ。
 * Canvas でも、UI の役割の色（ブランド・状態・金属・夜の盤・紙吹雪）はここから取る。絵の部品の色（屋根・服・木など）は各絵のファイルの色表でよい（docs/10_color_system.md）。
 */

/** アプリ全体の基本色（tokens.css と同じ値） */
export const PALETTE = {
  /** ブランド主色（ロイヤルブルー。2026-11-09 にコーラルから変更）。現在地・主要操作 */
  brand: '#1e6bff',
  /** 白地の文字・濃い塗り用の青 */
  brandInk: '#1556d6',
  brandSoft: '#e8f0ff',
  /** ブランドの段（tokens.css の --brand-300 / -400 / -700 / -900） */
  brandLight: '#8bb3ff',
  brandBright: '#5a90ff',
  brandDeep: '#1145b0',
  brandNight: '#0b2a66',
  /** ゲームの光の差し色（--glow） */
  glow: '#5ee0ff',
  /** 夜の盤（--night-950 / -900 / -800 / -700） */
  night950: '#070b17',
  night900: '#0b1530',
  night800: '#111d40',
  night700: '#1a2a5a',
  /** 状態の色（--success / --warning / --danger） */
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#e11d48',
  /** 金属の段（--metal-*。銅 → 銀 → 金 → 白金 → 伝説） */
  metalBronze: '#e0965f',
  metalSilver: '#c9d1dc',
  metalGold: '#f5b700',
  metalPlatinum: '#3cc8ff',
  metalLegend: '#cf8cff',
  /** 紙吹雪・きらめき（演出で共通。ブランド・金・白金・伝説・白） */
  confetti: ['#1e6bff', '#f5b700', '#3cc8ff', '#cf8cff', '#ffffff'],
  /** 文字色（濃いグレー） */
  ink: '#111827',
  subInk: '#374151',
  mutedInk: '#6b7280',
  white: '#ffffff',
  /** 地図の地（クールグレー） */
  paper: '#f2f4f7',
  paperDeep: '#eaedf1',
  /** 紙の繊維・しみ（ごく薄い点） */
  paperFiber: '#eef0f3',
  /** 地図の地面（芝・土の淡色） */
  meadow: '#f2f4f7',
  meadowDeep: '#eaedf1',
  /** 海 */
  sea: '#a8d8f4',
  seaDeep: '#7cc0ea',
  seaFoam: '#ffffff',
  /** 霧・遠い山（Lv0 の里山） */
  mist: '#f1f3f6',
  mountainFar: '#e5e7eb',
  mountainNear: '#d1d5db',
  /** 影（紙に落ちる柔らかい影） */
  shadow: 'rgba(17, 24, 39, 0.16)',
  shadowSoft: 'rgba(17, 24, 39, 0.08)',
  /** 家の壁（クリーム） */
  wall: '#ffffff',
  wallShade: '#e5e7eb',
  /** 木 */
  tree: '#34c77b',
  treeDark: '#16a34a',
  trunk: '#94a3b8',
  /** 灯り（Lv3） */
  lamp: '#ffd166',
  lampGlow: 'rgba(255, 209, 102, 0.35)',
  /** 地区の主・金 */
  gold: '#f5b700',
  goldDeep: '#d97706',
  goldInk: '#92400e',
  /** 色あせ（セピア） */
  sepia: '#9ca3af',
  sepiaInk: '#6b7280',
  /** 未発見・発見済み */
  unknown: '#9ca3af',
  discovered: '#6b7280',
  /** 期限・クーポン */
  deadline: '#e11d48',
  /** 地図ベースマップ（docs/08 §10.2。地図アプリ風の淡色） */
  land: '#f2f4f7',
  block: '#eaedf1',
  park: '#cdebd5',
  shrine: '#f7e3dc',
  campus: '#e6e9ee',
  water: '#a8d8f4',
  waterInk: '#2b7bb9',
  road: '#ffffff',
  roadCasing: '#d9dee5',
  arterialCasing: '#cdd3db',
  arcade: '#ffe3d9',
  rail: '#9ca3af',
  station: '#374151',
} as const;

/** Canvas の文字に使うフォント（tokens.css の --font-display と同じ並び） */
export const DISPLAY_FONT_FAMILY = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif';
