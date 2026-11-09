/**
 * @file 開始画面の街の絵（presentation/screens/Launch。Canvas 描画）
 * 空（朝・昼・夕・夜）→ 遠景のビル → 地区ごとの建物がにょきっと伸びる → ピンが落ちて弾む → 自分のアバターが歩いてくる、を時間で描く。
 * 建物は旅人の地区の成長 Lv から作る（育った地区ほど高い塔とライトアップ。未訪問はシルエット＋「？」のピン、色あせは灰色＋「◌」）。
 * 絵の部品は shared/cityArt（マイ街・演出と同じフラットな街）を使う。乱数は使わず、模様とまたたきは座標・番号のハッシュで決める。
 * 毎フレーム描画なので関数ログは出さない（計画づくり planLaunchScene だけログを出す）。
 */
import { createLogger } from '@/Common/logging/logger';
import type { CanvasSize } from '@/Common/ui/canvas/CanvasBase';
import { beginFrame } from '@/Common/ui/canvas/CanvasBase';
import { mixColors, toRgba } from '@/Common/ui/canvas/colorUtils';
import { PALETTE } from '@/Common/ui/theme/palette';
import { CANVAS_FONT_FAMILY } from '@/Common/ui/canvas/drawUtils';
import { FADE_ICON } from '@/Common/ui/canvas/fadeStyle';
import type { AvatarSprite } from '@/presentation/shared/avatarSprite';
import {
  colorTone,
  fillBox,
  fillDisc,
  grayTone,
  hash2,
  paintCloud,
  paintFarSkyline,
  paintMidrise,
  paintShopfront,
  paintSky,
  paintStreetLamp,
  paintStreetTree,
  paintTower,
  silhouetteTone,
} from '@/presentation/shared/cityArt';
import type { ArtBox, CityTone } from '@/presentation/shared/cityArt';
import { easeOutBack, easeOutBounce, easeOutCubic, spanProgress } from '@/presentation/screens/Launch/launchModel';
import type { LaunchDistrictArt, SkyPhase } from '@/presentation/screens/Launch/launchModel';

const logger = createLogger('presentation/screens/Launch/launchScene');

/** 時間割（ms。開始画面が開きはじめた時刻からの経過） */
export const SCENE_TIMING = {
  /** 遠景がうっすら出る */
  farIn: 150,
  /** 最初の建物が伸びはじめる */
  riseStart: 380,
  /** 地区ごとのずれ */
  riseStagger: 120,
  riseDuration: 720,
  /** ピンが落ちはじめる */
  pinStart: 1250,
  pinStagger: 110,
  pinDuration: 760,
  /** アバターが歩いてくる */
  walkStart: 1500,
  walkDuration: 1700,
  /** 足もとの波紋（発見の円）が出はじめる */
  radarStart: 3300,
  radarPeriod: 2400,
  /** ぴょんと跳ねる間隔 */
  hopPeriod: 5200,
  hopDuration: 620,
  /** きらめきが出はじめる */
  sparkleStart: 1900,
  /** すべての入場が終わる（これ以降はゆるい繰り返しだけ） */
  settled: 3400,
} as const;

/** 空・地面の色（時間帯ごと） */
interface SkyColors {
  readonly sky: readonly [string, string, string];
  readonly far: readonly [string, string];
  readonly sidewalk: string;
  readonly sidewalkLine: string;
  readonly road: string;
  readonly plaza: string;
  /** 太陽・月（中心の色） */
  readonly orb: string;
  readonly lit: boolean;
}

/** 時間帯ごとの色 */
const SKY_COLORS: Readonly<Record<SkyPhase, SkyColors>> = {
  dawn: { sky: ['#ffbfa0', '#ffe0c6', '#fff4e8'], far: ['#f3cfbf', '#eabda9'], sidewalk: '#f6ece4', sidewalkLine: '#ead9cc', road: '#6b6472', plaza: '#f5e6da', orb: '#ffb46b', lit: false },
  day: { sky: ['#7cc3f2', '#bfe2f8', '#eef8fe'], far: ['#cfe3f3', '#bad3e9'], sidewalk: '#eef0f3', sidewalkLine: '#dfe3e9', road: '#4b5563', plaza: '#e3eaf1', orb: '#ffd166', lit: false },
  dusk: { sky: ['#5546ad', '#ee7a7c', '#ffd39a'], far: ['#b9809f', '#9d6890'], sidewalk: '#f1e1d8', sidewalkLine: '#e3cbbd', road: '#4a3f5c', plaza: '#ecd6cc', orb: '#ff9a5a', lit: true },
  night: { sky: ['#0a1030', '#1b2552', '#33427a'], far: ['#1d2750', '#26346a'], sidewalk: '#384365', sidewalkLine: '#2f3858', road: '#1b2140', plaza: '#232b4c', orb: '#fff6d5', lit: true },
};

/** 画面の割り付け（CSS px） */
export interface SceneLayout {
  readonly width: number;
  readonly height: number;
  /** 建物の足元（歩道の上端） */
  readonly groundY: number;
  /** いちばん高い建物の高さ */
  readonly maxH: number;
  readonly sidewalkH: number;
  readonly roadH: number;
}

/** 歩道の高さ */
const SIDEWALK_H = 26;
/** 車道の高さ */
const ROAD_H = 32;
/** 建物の高さの上限 */
const MAX_BUILDING_H = 230;
/** 建物の高さの下限 */
const MIN_BUILDING_H = 80;
/** 塔の上に立つピン（王冠つき）のために空ける高さ */
const PIN_ROOM = 44;

/**
 * 画面の割り付けを決める。カード（下）とタイトル（上）の実際の位置から、街並みが両方に隠れないようにする。
 * @param size canvas の大きさ
 * @param bounds タイトルの下端・カードの上端（canvas 内の Y。測れなければ割合で決める）
 * @returns 割り付け
 */
export function sceneLayoutOf(size: { readonly width: number; readonly height: number }, bounds: { readonly titleBottom?: number; readonly cardTop?: number }): SceneLayout { // audit-ignore: fnlog-missing 大きさが変わるたびに呼ぶ純粋な算術
  const { width, height } = size;
  const floor = bounds.cardTop ?? height * 0.6;
  const groundY = Math.max(height * 0.36, floor - ROAD_H - SIDEWALK_H - 6);
  const titleBottom = bounds.titleBottom ?? height * 0.22;
  const maxH = Math.max(MIN_BUILDING_H, Math.min(MAX_BUILDING_H, groundY - titleBottom - 8 - PIN_ROOM));
  return { width, height, groundY, maxH, sidewalkH: SIDEWALK_H, roadH: ROAD_H };
}

/** 街並みの1つの部品 */
interface SceneItem {
  readonly kind: 'tower' | 'midrise' | 'shop' | 'tree' | 'lamp';
  readonly box: ArtBox;
  readonly tone: CityTone;
  readonly seed: number;
  /** 伸びはじめ（ms） */
  readonly at: number;
  readonly blossom: boolean;
  /** 色のついた建物（きらめきを出す） */
  readonly bright: boolean;
}

/** 地区のピン */
interface ScenePin {
  readonly x: number;
  /** 着地する Y（ピンの先） */
  readonly y: number;
  readonly color: string;
  readonly glyph: '?' | 'fade' | 'dot';
  readonly lord: boolean;
  readonly at: number;
  readonly index: number;
}

/** 描く計画（大きさ・内容が変わったときだけ作り直す） */
export interface ScenePlan {
  readonly sky: SkyPhase;
  readonly layout: SceneLayout;
  readonly colors: SkyColors;
  readonly back: readonly SceneItem[];
  readonly front: readonly SceneItem[];
  readonly pins: readonly ScenePin[];
}

/**
 * 地区の色一式を決める（未訪問=シルエット、色あせ=灰色、それ以外=地区色。夕方・夜は窓に灯り）。
 * @param d 地区
 * @param lit ライトアップするか
 * @returns 色一式
 */
function toneOf(d: LaunchDistrictArt, lit: boolean): CityTone { // audit-ignore: fnlog-missing 計画づくりで地区ごとに呼ぶ純粋な変換
  if (d.level === 0) return silhouetteTone();
  const tone = colorTone(d.color, { lit: lit || d.level >= 3 });
  return d.faded ? grayTone(tone, 0.12) : tone;
}

/** 成長段階ごとの塔の高さ（最大に対する割合） */
const TOWER_SCALE: readonly number[] = [0.66, 0.62, 0.8, 1];

/**
 * 街並みの計画を作る（地区ごとに 塔・中層ビル（奥）と 店・木・街灯（手前））。
 * @param districts 地区（最大5）
 * @param sky 空の時間帯
 * @param layout 割り付け
 * @returns 計画
 */
export function planLaunchScene(districts: readonly LaunchDistrictArt[], sky: SkyPhase, layout: SceneLayout): ScenePlan {
  const log = logger.fn('planLaunchScene', { districts: districts.length, sky, width: layout.width });
  const colors = SKY_COLORS[sky];
  const n = Math.max(1, districts.length);
  const cw = layout.width / n;
  const base = layout.groundY;
  const back: SceneItem[] = [];
  const front: SceneItem[] = [];
  const pins: ScenePin[] = [];
  districts.forEach((d, i) => {
    const x0 = i * cw;
    const seed = hash2(i + 7, d.id.length * 31 + d.level);
    const tone = toneOf(d, colors.lit);
    const bright = d.level > 0 && !d.faded;
    const at = SCENE_TIMING.riseStart + i * SCENE_TIMING.riseStagger;
    const jitter = 0.86 + (seed % 15) / 100;
    const towerH = layout.maxH * (TOWER_SCALE[d.level] ?? 0.62) * jitter;
    const tower: ArtBox = { x: x0 + cw * (0.06 + (seed % 8) / 100), base, w: cw * 0.36, h: towerH };
    const midH = layout.maxH * (0.4 + ((seed >>> 3) % 14) / 100) * (d.level >= 2 ? 1.08 : 1);
    back.push(
      { kind: 'tower', box: tower, tone, seed: seed % 3, at, blossom: false, bright },
      { kind: 'midrise', box: { x: x0 + cw * 0.47, base, w: cw * 0.44, h: midH }, tone, seed: seed >>> 5, at: at + 70, blossom: false, bright },
    );
    const shopH = Math.max(30, layout.maxH * 0.19);
    front.push(
      { kind: 'shop', box: { x: x0 + cw * 0.02, base, w: cw * 0.42, h: shopH }, tone, seed: seed >>> 7, at: at + 200, blossom: false, bright },
      { kind: 'tree', box: { x: x0 + cw * 0.56, base, w: cw * 0.26, h: cw * 0.44 }, tone, seed, at: at + 320, blossom: (seed >>> 2) % 3 === 0, bright },
      { kind: 'lamp', box: { x: x0 + cw * 0.9, base, w: 0, h: Math.max(30, layout.maxH * 0.2) }, tone, seed, at: at + 380, blossom: false, bright },
    );
    pins.push({
      x: tower.x + tower.w * 0.5,
      y: base - towerH - 6,
      color: d.level === 0 || d.faded ? PALETTE.unknown : d.color,
      glyph: d.level === 0 ? '?' : d.faded ? 'fade' : 'dot',
      lord: d.isLordMe,
      at: SCENE_TIMING.pinStart + i * SCENE_TIMING.pinStagger,
      index: i,
    });
  });
  return log.exit({ sky, layout, colors, back, front, pins });
}

/** フレームごとの入力 */
export interface SceneFrame {
  /** 開きはじめからの経過（ms） */
  readonly t: number;
  /** 自分のアバター（作れなければ undefined） */
  readonly avatar?: AvatarSprite;
}

/**
 * 開始画面の街を1フレーム描く。
 * @param ctx 2D コンテキスト
 * @param size canvas の大きさ
 * @param plan 計画
 * @param frame 経過時間・アバター
 * @sideEffect ctx に描画する
 */
export function drawLaunchScene(ctx: CanvasRenderingContext2D, size: CanvasSize, plan: ScenePlan, frame: SceneFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  beginFrame(ctx, size);
  const { t } = frame;
  const L = plan.layout;
  paintSkyLayer(ctx, plan, t);
  paintStreak(ctx, plan, t);
  ctx.save();
  ctx.globalAlpha = spanProgress(t, SCENE_TIMING.farIn, 500);
  paintFarSkyline(ctx, { from: 0, to: L.width }, { base: L.groundY, offset: 11, color: plan.colors.far[0], minH: L.maxH * 0.28, maxH: L.maxH * 0.6, seed: 5, unit: 26 });
  paintFarSkyline(ctx, { from: 0, to: L.width }, { base: L.groundY, offset: 3, color: plan.colors.far[1], minH: L.maxH * 0.16, maxH: L.maxH * 0.38, seed: 9, unit: 20 });
  ctx.restore();
  paintLordBeams(ctx, plan, t);
  paintBokeh(ctx, plan, t);
  paintGround(ctx, plan);
  for (const item of plan.back) paintRising(ctx, item, t);
  for (const item of plan.front) paintRising(ctx, item, t);
  for (const pin of plan.pins) paintPin(ctx, pin, t);
  paintSparkles(ctx, plan, t);
  paintTraveler(ctx, plan, frame);
}

/** 光の粒の数 */
const BOKEH_COUNT = 24;

/**
 * 空へ昇っていく光の粒（ぼけた丸。ゆっくり明滅しながら左右に揺れる）を描く。
 * @param ctx 描画先
 * @param plan 計画
 * @param t 経過（ms）
 */
function paintBokeh(ctx: CanvasRenderingContext2D, plan: ScenePlan, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const L = plan.layout;
  const rgb = plan.sky === 'night' ? '255, 232, 160' : plan.sky === 'day' ? '255, 255, 255' : '255, 226, 190';
  const fadeIn = spanProgress(t, 300, 900);
  if (fadeIn <= 0) return;
  const span = L.groundY + 40;
  for (let i = 0; i < BOKEH_COUNT; i++) {
    const v = hash2(i, 31);
    const speed = 0.014 + ((v >>> 4) % 12) / 1000;
    const y = L.groundY + 20 - ((t * speed + ((v % 1000) / 1000) * span) % span);
    const x = (((v >>> 12) % 1000) / 1000) * L.width + Math.sin(t / 1400 + i) * 9;
    const r = 1.6 + ((v >>> 22) % 5) * 0.9;
    const a = (0.16 + 0.34 * Math.abs(Math.sin(t / 820 + i * 1.3))) * fadeIn * Math.min(1, (L.groundY - y) / 80 + 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
    g.addColorStop(0, `rgba(${rgb}, ${a.toFixed(3)})`);
    g.addColorStop(0.45, `rgba(${rgb}, ${(a * 0.55).toFixed(3)})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
  }
}

/** 流れる光の間隔と長さ（ms） */
const STREAK = { start: 2100, period: 4300, duration: 760 } as const;

/**
 * 空を斜めに横切る光の筋（夜は流れ星、昼はきらり）を描く。
 * @param ctx 描画先
 * @param plan 計画
 * @param t 経過（ms）
 */
function paintStreak(ctx: CanvasRenderingContext2D, plan: ScenePlan, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (t < STREAK.start) return;
  const age = (t - STREAK.start) % STREAK.period;
  if (age > STREAK.duration) return;
  const L = plan.layout;
  const v = hash2(Math.floor((t - STREAK.start) / STREAK.period), 57);
  const p = easeOutCubic(age / STREAK.duration);
  const sx = L.width * (0.08 + (v % 40) / 100);
  const sy = L.groundY * (0.16 + ((v >>> 8) % 18) / 100);
  const run = L.width * 0.55;
  const hx = sx + run * p;
  const hy = sy + run * 0.32 * p;
  const tail = 110 * (1 - p * 0.4);
  const alpha = Math.sin(Math.PI * Math.min(1, age / STREAK.duration));
  const g = ctx.createLinearGradient(hx - tail, hy - tail * 0.32, hx, hy);
  g.addColorStop(0, 'rgba(255, 255, 255, 0)');
  g.addColorStop(1, `rgba(255, 255, 255, ${(alpha * 0.95).toFixed(3)})`);
  ctx.save();
  ctx.strokeStyle = g;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx - tail, hy - tail * 0.32);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  paintHalo(ctx, hx, hy, 10, `rgba(255, 255, 255, ${(alpha * 0.8).toFixed(3)})`);
  ctx.restore();
}

/**
 * 自分が主の地区に立つ金色の光の柱（ピンが着地してから、ゆっくり脈打つ）を描く。
 * @param ctx 描画先
 * @param plan 計画
 * @param t 経過（ms）
 */
function paintLordBeams(ctx: CanvasRenderingContext2D, plan: ScenePlan, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const L = plan.layout;
  for (const pin of plan.pins) {
    if (!pin.lord) continue;
    const show = spanProgress(t, pin.at + SCENE_TIMING.pinDuration * 0.6, 600);
    if (show <= 0) continue;
    const pulse = 0.75 + 0.25 * Math.sin(t / 650 + pin.index);
    const w = 34 + 10 * pulse;
    const top = Math.max(0, pin.y - 150);
    const h = L.groundY - top;
    const g = ctx.createLinearGradient(0, top, 0, L.groundY);
    g.addColorStop(0, 'rgba(255, 214, 102, 0)');
    g.addColorStop(0.4, `rgba(255, 214, 102, ${(0.32 * show * pulse).toFixed(3)})`);
    g.addColorStop(1, `rgba(255, 236, 170, ${(0.5 * show * pulse).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(pin.x - w / 2, top, w, h);
    const core = ctx.createLinearGradient(0, top, 0, L.groundY);
    core.addColorStop(0, 'rgba(255, 250, 225, 0)');
    core.addColorStop(0.4, `rgba(255, 250, 225, ${(0.38 * show * pulse).toFixed(3)})`);
    core.addColorStop(1, `rgba(255, 250, 225, ${(0.45 * show * pulse).toFixed(3)})`);
    ctx.fillStyle = core;
    ctx.fillRect(pin.x - w * 0.12, top, w * 0.24, h);
  }
}

/**
 * 空（グラデーション・太陽か月・星・雲・鳥）を描く。
 * @param ctx 描画先
 * @param plan 計画
 * @param t 経過（ms）
 */
function paintSkyLayer(ctx: CanvasRenderingContext2D, plan: ScenePlan, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const L = plan.layout;
  const [top, mid, bottom] = plan.colors.sky;
  paintSky(ctx, [0, 0, L.width, L.groundY * 0.55], [top, mid]);
  paintSky(ctx, [0, L.groundY * 0.55 - 1, L.width, L.groundY * 0.45 + 1], [mid, bottom]);
  const night = plan.sky === 'night';
  const high = night || plan.sky === 'day';
  if (night) paintStars(ctx, L, t);
  const rise = easeOutCubic(spanProgress(t, 0, 1600));
  const orbX = L.width * (night ? 0.8 : high ? 0.84 : 0.74);
  const orbY = L.groundY - L.maxH * (high ? 1.02 : 0.62) - 22 * rise + 22;
  const r = night ? 15 : high ? 22 : 30;
  paintHalo(ctx, orbX, orbY, r * 3.2, toRgba(plan.colors.orb, night ? 0.28 : 0.45));
  fillDisc(ctx, orbX, orbY, r, plan.colors.orb);
  if (night) fillDisc(ctx, orbX + r * 0.45, orbY - r * 0.3, r * 0.86, mixColors(top, mid, 0.5));
  ctx.save();
  ctx.globalAlpha = night ? 0.18 : 0.95;
  const span = L.width + 160;
  for (let i = 0; i < 3; i++) {
    const speed = 0.006 + i * 0.003;
    const x = ((i * 157 + t * speed) % span) - 120;
    paintCloud(ctx, x, L.groundY * (0.28 + i * 0.13), 64 + i * 18);
  }
  ctx.restore();
  if (!night) paintBirds(ctx, L, t);
}

/**
 * 夜空の星（ゆっくりまたたく）を描く。
 * @param ctx 描画先
 * @param L 割り付け
 * @param t 経過（ms）
 */
function paintStars(ctx: CanvasRenderingContext2D, L: SceneLayout, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < 46; i++) {
    const v = hash2(i, 77);
    const x = (v % 1000) / 1000 * L.width;
    const y = ((v >>> 10) % 1000) / 1000 * (L.groundY - L.maxH * 0.5);
    const a = 0.35 + 0.65 * Math.abs(Math.sin(t / 900 + i * 1.7));
    fillDisc(ctx, x, y, (v >>> 20) % 3 === 0 ? 1.5 : 1, `rgba(255, 255, 255, ${a.toFixed(3)})`);
  }
}

/**
 * 横切る小鳥（「く」の字）を描く。
 * @param ctx 描画先
 * @param L 割り付け
 * @param t 経過（ms）
 */
function paintBirds(ctx: CanvasRenderingContext2D, L: SceneLayout, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.strokeStyle = 'rgba(31, 41, 55, 0.55)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  const span = L.width + 80;
  for (let i = 0; i < 3; i++) {
    const x = ((t * 0.035 + i * 46) % span) - 40;
    const y = L.groundY - L.maxH * 1.05 + i * 9 + Math.sin(t / 380 + i) * 4;
    const flap = Math.sin(t / 110 + i * 2) * 2.2;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 2 - flap);
    ctx.quadraticCurveTo(x - 2, y - 1, x, y + 1);
    ctx.quadraticCurveTo(x + 2, y - 1, x + 5, y - 2 - flap);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * やわらかい光の輪を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 半径
 * @param color 中心の色（rgba）
 */
function paintHalo(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/**
 * 歩道・縁石・車道（白い破線）・その下の広場を描く。
 * @param ctx 描画先
 * @param plan 計画
 */
function paintGround(ctx: CanvasRenderingContext2D, plan: ScenePlan): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const L = plan.layout;
  const c = plan.colors;
  const y0 = L.groundY;
  fillBox(ctx, [0, y0, L.width, L.sidewalkH], c.sidewalk);
  ctx.fillStyle = c.sidewalkLine;
  for (let x = 12; x < L.width; x += 26) ctx.fillRect(x, y0 + 3, 1, L.sidewalkH - 6);
  fillBox(ctx, [0, y0 + L.sidewalkH - 3, L.width, 3], mixColors(c.sidewalk, '#111827', 0.12));
  const ry = y0 + L.sidewalkH;
  fillBox(ctx, [0, ry, L.width, L.roadH], c.road);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  for (let x = 8; x < L.width; x += 34) ctx.fillRect(x, ry + L.roadH / 2 - 1, 16, 2);
  const py = ry + L.roadH;
  fillBox(ctx, [0, py, L.width, Math.max(0, L.height - py)], c.plaza);
  paintPaving(ctx, { x: 0, y: py, w: L.width, h: L.height - py }, mixColors(c.plaza, c.road, 0.1));
}

/**
 * 広場の敷石（角丸の石を互い違いに並べる）を描く。カードの下も空っぽに見せない。
 * @param ctx 描画先
 * @param area 描く範囲
 * @param color 石の色
 */
function paintPaving(ctx: CanvasRenderingContext2D, area: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const stone = 22;
  const gap = 4;
  for (let row = 0, y = area.y + 6; y < area.y + area.h; row++, y += stone * 0.62 + gap) {
    const offset = row % 2 === 0 ? 0 : stone / 2;
    for (let x = area.x - offset; x < area.x + area.w; x += stone + gap) {
      fillBox(ctx, [x, y, stone, stone * 0.62], color, 4);
    }
  }
}

/**
 * 部品を、足元から伸びる（建物）・ぽんと出る（木・街灯）動きで描く。
 * @param ctx 描画先
 * @param item 部品
 * @param t 経過（ms）
 */
function paintRising(ctx: CanvasRenderingContext2D, item: SceneItem, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const raw = spanProgress(t, item.at, SCENE_TIMING.riseDuration);
  if (raw <= 0) return;
  const p = Math.max(0, easeOutBack(raw));
  const b = item.box;
  const cx = b.x + b.w / 2;
  const grows = item.kind !== 'tree' && item.kind !== 'lamp';
  const sx = grows ? (p < 1 ? 1 + (1 - p) * 0.22 : 1 - (p - 1) * 0.6) : p;
  ctx.save();
  ctx.translate(cx, b.base);
  ctx.scale(sx, p);
  ctx.translate(-cx, -b.base);
  switch (item.kind) {
    case 'tower': paintTower(ctx, b, item.tone, item.seed); break;
    case 'midrise': paintMidrise(ctx, b, item.tone, { seed: item.seed, shopBase: item.tone.detail }); break;
    case 'shop': paintShopfront(ctx, b, item.tone, { floors: item.tone.detail ? 2 : 1, seed: item.seed }); break;
    case 'tree': paintStreetTree(ctx, b, item.tone, item.blossom); break;
    case 'lamp': paintStreetLamp(ctx, b.x, b.base, b.h, item.tone); break;
  }
  ctx.restore();
}

/**
 * 地区のピンを、空から落ちて弾み、ふわふわ揺れる動きで描く（主の地区は王冠つき）。
 * @param ctx 描画先
 * @param pin ピン
 * @param t 経過（ms）
 */
function paintPin(ctx: CanvasRenderingContext2D, pin: ScenePin, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const raw = spanProgress(t, pin.at, SCENE_TIMING.pinDuration);
  if (raw <= 0) return;
  const landed = raw >= 1;
  const bob = landed ? Math.sin((t - pin.at) / 520 + pin.index) * 2.2 : 0;
  const y = -30 + (pin.y + 30) * easeOutBounce(raw) + bob;
  const x = pin.x;
  const r = 9.5;
  const headY = y - 17;
  ctx.save();
  ctx.fillStyle = 'rgba(17, 24, 39, 0.18)';
  ctx.beginPath();
  ctx.ellipse(x, pin.y + 1, 6 * (landed ? 1 : raw), 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, headY, r + 2, Math.PI * 0.82, Math.PI * 2.18);
  ctx.lineTo(x, y + 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = pin.color;
  ctx.beginPath();
  ctx.arc(x, headY, r, Math.PI * 0.8, Math.PI * 2.2);
  ctx.lineTo(x, y - 1);
  ctx.closePath();
  ctx.fill();
  paintPinGlyph(ctx, pin, x, headY);
  if (pin.lord) paintCrown(ctx, x, headY - r - 4);
  ctx.restore();
}

/**
 * ピンの中の印（未訪問「？」・色あせ「◌」・訪問済みの白い点）を描く。
 * @param ctx 描画先
 * @param pin ピン
 * @param x 中心 X
 * @param y 中心 Y
 */
function paintPinGlyph(ctx: CanvasRenderingContext2D, pin: ScenePin, x: number, y: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (pin.glyph === 'dot') {
    fillDisc(ctx, x, y, 3.6, '#ffffff');
    return;
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${pin.glyph === '?' ? 12 : 11}px ${CANVAS_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pin.glyph === '?' ? '?' : FADE_ICON, x, y + 0.5);
}

/**
 * 地区の主の王冠（金）を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 下端 Y
 */
function paintCrown(ctx: CanvasRenderingContext2D, x: number, y: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = PALETTE.metalGold;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 7, y);
  ctx.lineTo(x - 8, y - 8);
  ctx.lineTo(x - 3.5, y - 4);
  ctx.lineTo(x, y - 10);
  ctx.lineTo(x + 3.5, y - 4);
  ctx.lineTo(x + 8, y - 8);
  ctx.lineTo(x + 7, y);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

/**
 * 色のついた建物のまわりに、ときどききらめきを出す（どこに出るかは番号のハッシュで決める）。
 * @param ctx 描画先
 * @param plan 計画
 * @param t 経過（ms）
 */
function paintSparkles(ctx: CanvasRenderingContext2D, plan: ScenePlan, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (t < SCENE_TIMING.sparkleStart) return;
  const bright = plan.back.filter((item) => item.bright);
  if (bright.length === 0) return;
  const slotMs = 420;
  const life = 1100;
  const now = Math.floor((t - SCENE_TIMING.sparkleStart) / slotMs);
  for (let k = Math.max(0, now - 2); k <= now; k++) {
    const age = t - SCENE_TIMING.sparkleStart - k * slotMs;
    if (age < 0 || age > life) continue;
    const v = hash2(k, 13);
    const item = bright[v % bright.length];
    if (item === undefined) continue;
    const b = item.box;
    const x = b.x + ((v >>> 8) % 100) / 100 * b.w;
    const y = b.base - b.h * (0.55 + ((v >>> 16) % 50) / 100);
    const r = 6.5 * Math.sin(Math.PI * (age / life));
    paintSparkle(ctx, x, y, r, plan.colors.lit ? '#fff3b0' : '#ffffff');
  }
}

/**
 * 4方向のきらめき（細いひし形を2つ重ねた星）を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param r 大きさ
 * @param color 色
 */
function paintSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (r <= 0.2) return;
  const k = r * 0.22;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + k, y - k); ctx.lineTo(x + r, y); ctx.lineTo(x + k, y + k);
  ctx.lineTo(x, y + r); ctx.lineTo(x - k, y + k); ctx.lineTo(x - r, y); ctx.lineTo(x - k, y - k);
  ctx.closePath();
  ctx.fill();
}

/**
 * 自分のアバター（歩いてきて止まり、ときどき跳ねる）・足あと・足もとの発見の波紋を描く。
 * @param ctx 描画先
 * @param plan 計画
 * @param frame 経過時間・アバター
 */
function paintTraveler(ctx: CanvasRenderingContext2D, plan: ScenePlan, frame: SceneFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { t, avatar } = frame;
  if (t < SCENE_TIMING.walkStart) return;
  const L = plan.layout;
  const footY = L.groundY + L.sidewalkH * 0.72;
  const fromX = -36;
  const toX = L.width * 0.2;
  const walk = spanProgress(t, SCENE_TIMING.walkStart, SCENE_TIMING.walkDuration);
  const x = fromX + (toX - fromX) * easeOutCubic(walk);
  const walking = walk < 0.97;
  paintFootprints(ctx, fromX, x, footY, plan.colors.lit);
  if (t >= SCENE_TIMING.radarStart) paintRadar(ctx, x, footY, (t - SCENE_TIMING.radarStart) % SCENE_TIMING.radarPeriod / SCENE_TIMING.radarPeriod);
  const hopAge = t >= SCENE_TIMING.settled ? (t - SCENE_TIMING.settled) % SCENE_TIMING.hopPeriod : -1;
  const hop = hopAge >= 0 && hopAge < SCENE_TIMING.hopDuration ? Math.sin(Math.PI * hopAge / SCENE_TIMING.hopDuration) * 14 : 0;
  const bob = walking ? Math.abs(Math.sin(t / 95)) * 3 : Math.sin(t / 520) * 0.8;
  ctx.save();
  ctx.fillStyle = 'rgba(17, 24, 39, 0.2)';
  ctx.beginPath();
  ctx.ellipse(x, footY, 11 - hop * 0.3, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const y = footY - bob - hop;
  if (avatar !== undefined) {
    const tilt = walking ? Math.sin(t / 95) * 0.06 : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.drawImage(avatar.image, -avatar.footX, -avatar.footY, avatar.width, avatar.height);
    ctx.restore();
  } else {
    fillDisc(ctx, x, y - 30, 9, PALETTE.brand);
    fillBox(ctx, [x - 8, y - 20, 16, 20], PALETTE.brand, 6);
  }
  if (hop > 10) paintSparkle(ctx, x + 16, y - 52, 5, PALETTE.metalGold);
}

/**
 * 歩いてきた跡（小さな足あと。古いほど薄い）を描く。
 * @param ctx 描画先
 * @param fromX 歩きはじめの X
 * @param toX いまの X
 * @param y 足もとの Y
 * @param dark 夜・夕方（足あとを明るくする）
 */
function paintFootprints(ctx: CanvasRenderingContext2D, fromX: number, toX: number, y: number, dark: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const step = 15;
  for (let fx = fromX + step, k = 0; fx < toX - 10; fx += step, k++) {
    const a = Math.max(0, 1 - (toX - fx) / 150) * 0.32;
    if (a <= 0.01) continue;
    ctx.fillStyle = dark ? `rgba(255, 255, 255, ${a.toFixed(3)})` : `rgba(17, 24, 39, ${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(fx, y + (k % 2 === 0 ? -2.5 : 2), 2.6, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 足もとから広がる発見の波紋（だ円の輪。外へ行くほど薄い）を描く。
 * @param ctx 描画先
 * @param x 中心 X
 * @param y 中心 Y
 * @param p 進み具合 0〜1
 */
function paintRadar(ctx: CanvasRenderingContext2D, x: number, y: number, p: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const rx = 16 + p * 78;
  ctx.save();
  ctx.strokeStyle = toRgba(PALETTE.brand, (1 - p) * 0.7);
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.26, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
