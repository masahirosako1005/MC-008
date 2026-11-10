/**
 * @file 地区の札（布の旗・Lv の印・領主の名前の紙札。presentation/screens/Map/town 層。毎フレーム描く）
 * 2026-11-10 ユーザー指示「街の表示がシステム表示みたいな感じに見えるので、旅をしているときの温かみある表示にしたい」。
 * 白い角丸の札（システムの部品のような見た目）をやめ、旅先の街角にあるような布の旗（両端が燕尾・縫い目の点線）に、
 * Lv の丸い印（はんこ）と、領主の名前の紙札を下げる。領地のマス数は出さない（ユーザー指示「マスの概念はいらない」）。
 * 広域は王者の台座（championTowers）の下に、中間は地区の中心に描く。座標はログに出さない。
 */
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { toRgba } from '@/Common/ui/canvas/colorUtils';
import { PALETTE } from '@/Common/ui/theme/palette';
import { project } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, MapDistrictVm, Viewport } from '@/presentation/screens/Map/MapViewModel';
import { TERRITORY_RIVAL_COLOR } from '@/presentation/screens/Map/town/townTypes';

/** 札に描く地区 */
export interface BannerDistrict {
  readonly name: string;
  readonly color: string;
  readonly level: number;
  readonly isLordMe: boolean;
  /** 領主の名前（主なしなら無し。自分が領主なら「あなた」） */
  readonly lordName?: string;
  /** 領主の座を奪われて奪還中 */
  readonly lordLost?: boolean;
  /** 色あせのタグ（'色あせ'／'あと5日'） */
  readonly fadeTag?: string;
  /** 色あせの不透明度（0..1） */
  readonly alpha: number;
}

/**
 * 旗の白い文字を読みやすくする値（2026-11-10 ユーザー指示「白文字が背景と同化して見づらい」）。
 * 布は地区色をしっかり暗くし（からし色でも白文字とのコントラスト 4.5:1 以上）、文字はさらに濃いふちで囲む。
 * 色あせ中でも旗は薄くしすぎない（色あせは地区の塗り・タグで示す）。
 */
const RIBBON_CLOTH_SHADE = -0.4;
/** 旗の文字のふちの暗さ */
const RIBBON_TEXT_EDGE_SHADE = -0.62;
/** 旗の不透明度の下限 */
const RIBBON_MIN_ALPHA = 0.85;

/** 描いた札の大きさ（当たり判定・重なり回避用） */
export interface BannerBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * '#rrggbb' を暗く（または明るく）する。
 * @param hex 色
 * @param k -1..1（負で暗く、正で明るく）
 * @returns '#rrggbb'
 */
export function shade(hex: string, k: number): string { // audit-ignore: fnlog-missing 毎フレーム描画の色変換ヘルパー
  const n = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n) || hex.length !== 7) return hex;
  const r = shadeChannel((n >> 16) & 255, k);
  const g = shadeChannel((n >> 8) & 255, k);
  const b = shadeChannel(n & 255, k);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * 色の成分を1つ暗く（または明るく）する。
 * @param v 成分 0..255
 * @param k -1..1（負で暗く、正で明るく）
 * @returns 成分 0..255
 */
function shadeChannel(v: number, k: number): number { // audit-ignore: fnlog-missing 毎フレーム描画の色変換ヘルパー
  return Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
}

/**
 * 布の旗（両端が燕尾）の形を作る。
 * @param x 左
 * @param y 上
 * @param w 幅
 * @param h 高さ
 * @param notch 燕尾の切れ込みの深さ
 * @returns パス
 */
function ribbonPath(x: number, y: number, w: number, h: number, notch: number): Path2D { // audit-ignore: fnlog-missing 毎フレーム描画
  const p = new Path2D();
  p.moveTo(x, y);
  p.lineTo(x + w, y);
  p.lineTo(x + w - notch, y + h / 2);
  p.lineTo(x + w, y + h);
  p.lineTo(x, y + h);
  p.lineTo(x + notch, y + h / 2);
  p.closePath();
  return p;
}

/**
 * 小さな王冠を描く。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param s 大きさ（1 で幅 16px）
 * @sideEffect canvas に描く
 */
export function drawCrownGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.fillStyle = PALETTE.metalGold;
  ctx.strokeStyle = PALETTE.metalGoldEdge;
  ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 8 * s, y + 5 * s);
  ctx.lineTo(x - 8 * s, y - 4 * s);
  ctx.lineTo(x - 4 * s, y);
  ctx.lineTo(x, y - 6 * s);
  ctx.lineTo(x + 4 * s, y);
  ctx.lineTo(x + 8 * s, y - 4 * s);
  ctx.lineTo(x + 8 * s, y + 5 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PALETTE.metalGoldLight;
  ctx.fillRect(x - 6 * s, y + 2 * s, 12 * s, 1.4 * s);
  ctx.restore();
}

/**
 * 地区の布の旗を描く（Lv の印・自分が領主なら王冠・下に領主の紙札・色あせのタグ）。
 * @param ctx 2D コンテキスト
 * @param at 旗の上辺の中心
 * @param d 地区
 * @param textScale 文字の拡大率
 * @param size 大きさ（1 が標準。中間は小さめ）
 * @returns 描いた範囲
 * @sideEffect canvas に描く
 */
export function drawDistrictRibbon(ctx: CanvasRenderingContext2D, at: Point2D, d: BannerDistrict, textScale: number, size = 1): BannerBox { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.globalAlpha *= Math.max(RIBBON_MIN_ALPHA, d.alpha);
  const fontPx = 13 * size;
  ctx.font = canvasFont(fontPx, 800, textScale);
  const tw = ctx.measureText(d.name).width;
  const seal = 11 * size * textScale;
  const h = 22 * size * textScale;
  const notch = 6 * size;
  const crownW = d.isLordMe ? 16 * size : 0;
  const w = tw + seal * 2 + crownW + 26 * size;
  const x = at.x - w / 2;
  const y = at.y;
  const cloth = shade(d.color, RIBBON_CLOTH_SHADE);
  // 影 → 布 → 縫い目 → 文字
  ctx.fillStyle = toRgba(PALETTE.ink, 0.18);
  ctx.fill(ribbonPathAt(x, y + 2.5, w, h, notch));
  ctx.fillStyle = cloth;
  ctx.fill(ribbonPath(x, y, w, h, notch));
  ctx.fillStyle = toRgba(PALETTE.white, 0.16);
  ctx.fillRect(x + notch, y + 1, w - notch * 2, h * 0.38);
  ctx.setLineDash([2.5, 2.5]);
  ctx.strokeStyle = toRgba(PALETTE.white, 0.7);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + notch + 2, y + 3, w - notch * 2 - 4, h - 6);
  ctx.setLineDash([]);
  // Lv の丸い印（左端に重ねる）
  const sx = x + notch + seal + 2;
  const sy = y + h / 2;
  drawLevelSeal(ctx, { x: sx, y: sy }, seal, d.level, textScale, size);
  ctx.font = canvasFont(fontPx, 800, textScale);
  ctx.textAlign = 'left';
  const textX = sx + seal + 5 * size;
  // 白い文字は、布より濃いふちで囲んでから描く（布の色に溶けない）
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5 * size;
  ctx.strokeStyle = shade(d.color, RIBBON_TEXT_EDGE_SHADE);
  ctx.strokeText(d.name, textX, sy + 0.5);
  ctx.fillStyle = PALETTE.white;
  ctx.fillText(d.name, textX, sy + 0.5);
  if (d.isLordMe) drawCrownGlyph(ctx, textX + tw + 11 * size, sy, 0.62 * size);
  let bottom = y + h;
  // 領主の紙札（ひもで下げる）
  if (d.lordName !== undefined) bottom = drawLordTag(ctx, { x: at.x, y: y + h }, d, textScale, size);
  if (d.fadeTag !== undefined) drawFadeTag(ctx, { x: x + w - 6 * size, y: y - 12 * size * textScale }, d.fadeTag, textScale, size);
  ctx.restore();
  return { x, y, w, h: bottom - y };
}

/**
 * Lv の丸い印（はんこ。紙の丸にオレンジの縁、小さな「Lv」と大きな数字）。
 * @param ctx 2D コンテキスト
 * @param c 中心
 * @param r 半径
 * @param level 成長段階
 * @param textScale 文字の拡大率
 * @param size 大きさ
 * @sideEffect canvas に描く
 */
function drawLevelSeal(ctx: CanvasRenderingContext2D, c: Point2D, r: number, level: number, textScale: number, size: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = PALETTE.paper;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.brand;
  ctx.lineWidth = 2 * size;
  ctx.stroke();
  ctx.fillStyle = PALETTE.brandInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = canvasFont(6.5 * size, 800, textScale);
  ctx.fillText('Lv', c.x, c.y - 4.5 * size * textScale);
  ctx.font = canvasFont(10 * size, 800, textScale);
  ctx.fillText(String(level), c.x, c.y + 3.5 * size * textScale);
}

/**
 * 影用に少しずらした旗の形を作る。
 * @param x 左
 * @param y 上
 * @param w 幅
 * @param h 高さ
 * @param notch 切れ込み
 * @returns パス
 */
function ribbonPathAt(x: number, y: number, w: number, h: number, notch: number): Path2D { // audit-ignore: fnlog-missing 毎フレーム描画
  return ribbonPath(x + 1, y, w, h, notch);
}

/**
 * 旗の下に、領主の名前の紙札をひもで下げる（自分ならオレンジの縁、ライバルなら紫の縁。奪還中は「奪還」の印）。
 * @param ctx 2D コンテキスト
 * @param top ひもの上端
 * @param d 地区
 * @param textScale 文字の拡大率
 * @param size 大きさ
 * @returns 紙札の下端
 * @sideEffect canvas に描く
 */
function drawLordTag(ctx: CanvasRenderingContext2D, top: Point2D, d: BannerDistrict, textScale: number, size: number): number { // audit-ignore: fnlog-missing 毎フレーム描画
  const name = d.lordName ?? '';
  ctx.font = canvasFont(10 * size, 800, textScale);
  let text = name;
  while (ctx.measureText(text).width > 96 * size && text.length > 2) text = `${text.slice(0, -2)}…`;
  const tw = ctx.measureText(text).width;
  const lost = d.lordLost === true;
  const badge = lost ? 30 * size : 0;
  const w = tw + 26 * size + badge;
  const h = 17 * size * textScale;
  const y = top.y + 5 * size;
  const x = top.x - w / 2;
  ctx.strokeStyle = toRgba(PALETTE.ink, 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(top.x - 10 * size, top.y - 1);
  ctx.lineTo(top.x - 6 * size, y);
  ctx.moveTo(top.x + 10 * size, top.y - 1);
  ctx.lineTo(top.x + 6 * size, y);
  ctx.stroke();
  ctx.fillStyle = toRgba(PALETTE.ink, 0.14);
  ctx.beginPath();
  ctx.roundRect(x, y + 1.5, w, h, 4);
  ctx.fill();
  ctx.fillStyle = PALETTE.paper;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = d.isLordMe ? PALETTE.brand : TERRITORY_RIVAL_COLOR;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawCrownGlyph(ctx, x + 10 * size, y + h / 2, 0.48 * size);
  ctx.fillStyle = d.isLordMe ? PALETTE.brandInk : PALETTE.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 19 * size, y + h / 2 + 0.5);
  if (lost) {
    const bx = x + w - badge - 2 * size;
    ctx.fillStyle = PALETTE.danger;
    ctx.beginPath();
    ctx.roundRect(bx, y + 2.5 * size, badge - 1 * size, h - 5 * size, 3);
    ctx.fill();
    ctx.fillStyle = PALETTE.white;
    ctx.font = canvasFont(8.5 * size, 800, textScale);
    ctx.textAlign = 'center';
    ctx.fillText('奪還', bx + (badge - 1 * size) / 2, y + h / 2 + 0.5);
  }
  return y + h;
}

/**
 * 色あせのタグ（旗の右上に付く小さな白い紙。11px・墨の文字・まっすぐ＝小さくても読める。2026-11-10 UI/UX 改善）。
 * @param ctx 2D コンテキスト
 * @param at 下げる位置
 * @param text 文言
 * @param textScale 文字の拡大率
 * @param size 大きさ
 * @sideEffect canvas に描く
 */
function drawFadeTag(ctx: CanvasRenderingContext2D, at: Point2D, text: string, textScale: number, size: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(11, 700, textScale);
  const w = ctx.measureText(text).width + 12;
  const h = 17 * textScale;
  // 下端は元の札と同じ高さ（旗の上辺に少し掛かる）にそろえる
  ctx.translate(at.x, at.y + 14 * size * textScale - h);
  ctx.fillStyle = toRgba(PALETTE.ink, 0.18);
  ctx.beginPath();
  ctx.roundRect(-w / 2, 1.5, w, h, 4);
  ctx.fill();
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  ctx.roundRect(-w / 2, 0, w, h, 4);
  ctx.fill();
  ctx.fillStyle = PALETTE.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, h / 2 + 0.5);
  ctx.restore();
}

/** 中間の布の旗の大きさ */
const MIDDLE_BANNER_SIZE = 0.86;
/** 中間の布の旗の上辺（地区の中心からの高さ、CSS px） */
const MIDDLE_BANNER_DY = -46;

/**
 * 中間の布の旗が占めるおおよその矩形（吹き出しをそこに置かないために、描く前に求める）。
 * @param districts 地区
 * @param camera カメラ
 * @param vp 描画領域
 * @param lords 地区ID → 領主の情報
 * @param textScale 文字の拡大率
 * @returns 画面座標の矩形（画面の外の地区は除く）
 */
export function middleBannerBoxes(
  districts: readonly MapDistrictVm[],
  camera: Camera,
  vp: Viewport,
  lords: ReadonlyMap<string, { readonly lordName?: string }>,
  textScale: number,
): BannerBox[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = MIDDLE_BANNER_SIZE;
  const out: BannerBox[] = [];
  for (const d of districts) {
    const p = project(camera, vp, d.center);
    if (p.x < -90 || p.y < -50 || p.x > vp.width + 90 || p.y > vp.height + 50) continue;
    const tw = d.shortName.length * 13 * s * textScale;
    const w = tw + 22 * s * textScale + (d.isLordMe ? 16 * s : 0) + 26 * s + 8;
    const hasTag = !d.isLordMe && lords.get(d.id)?.lordName !== undefined;
    const h = 22 * s * textScale + (hasTag ? (5 + 17 * textScale) * s : 0) + 6;
    out.push({ x: p.x - w / 2, y: p.y + MIDDLE_BANNER_DY - 4, w, h });
  }
  return out;
}

/**
 * 中間の表示で、地区の中心に布の旗を描く（画面の外は描かない）。
 * @param ctx 2D コンテキスト
 * @param districts 地区
 * @param camera カメラ
 * @param vp 描画領域
 * @param lords 地区ID → 領主の情報（名前・奪還中）
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
export function drawMiddleDistrictBanners(
  ctx: CanvasRenderingContext2D,
  districts: readonly MapDistrictVm[],
  camera: Camera,
  vp: Viewport,
  lords: ReadonlyMap<string, { readonly lordName?: string; readonly lordLost?: boolean }>,
  textScale: number,
): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const d of districts) {
    const p = project(camera, vp, d.center);
    if (p.x < -90 || p.y < -50 || p.x > vp.width + 90 || p.y > vp.height + 50) continue;
    const lord = lords.get(d.id);
    drawDistrictRibbon(
      ctx,
      { x: p.x, y: p.y + MIDDLE_BANNER_DY },
      {
        name: d.shortName,
        color: d.color,
        level: d.level,
        isLordMe: d.isLordMe,
        ...(lord?.lordName === undefined || d.isLordMe ? {} : { lordName: lord.lordName }),
        ...(lord?.lordLost === undefined ? {} : { lordLost: lord.lordLost }),
        ...(d.fadeTag === undefined ? {} : { fadeTag: d.fadeTag }),
        alpha: d.fade.alpha,
      },
      textScale,
      MIDDLE_BANNER_SIZE,
    );
  }
}
