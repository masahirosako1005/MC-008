/**
 * @file 広域の「王者の台座」（presentation/screens/Map/town 層。毎フレーム描く）
 * 2026-11-10 ユーザー指示「広域エリアのときに、ジムリーダー的表示で王者をアバターつきで見せるようにしてほしい。タップして、ユーザ情報表示もしたい」。
 * 各地区の中心に石の台座を置き、その上に領主（直近30日の訪問回数が最多の人）のアバターが立ち、頭の上に王冠が浮かぶ。
 * 自分が領主なら金色の後光と回る光の筋、ライバルなら紫の気配、主なしなら空の台座に「？」。地区の雰囲気（にぎやか／廃れ気味）で台座の飾りが変わる。
 * 台座の下には地区の布の旗（districtBanners）と領主の名前の紙札。タップの当たり判定も返す。座標はログに出さない。
 */
import { toRgba } from '@/Common/ui/canvas/colorUtils';
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { PALETTE } from '@/Common/ui/theme/palette';
import type { AvatarSprite } from '@/presentation/shared/avatarSprite';
import { drawCrownGlyph, drawDistrictRibbon, shade } from '@/presentation/screens/Map/town/districtBanners';
import type { BannerBox } from '@/presentation/screens/Map/town/districtBanners';
import { TERRITORY_RIVAL_COLOR } from '@/presentation/screens/Map/town/townTypes';
import type { DistrictMood } from '@/presentation/screens/Map/town/vitality';

/** 台座の上に立つアバターの拡大率（mapPeople の地区表示と同じくらい） */
export const TOWER_AVATAR_SCALE = 0.64;
/** 台座の石の色（絵の部品） */
const STONE = { top: '#efe4cf', side: '#c4b193', edge: '#8f7c62', crack: '#7d6b53' } as const;
/** 台座の足もとの花（にぎやかな地区） */
const FLOWERS: readonly string[] = ['#f08aa6', '#f5c24a', '#ffffff', '#e8794a'];
/** 雑草（廃れ気味の地区） */
const WEED = '#8f9a5e';

/** 台座1つの入力 */
export interface ChampionTowerInput {
  readonly districtId: string;
  readonly name: string;
  readonly color: string;
  readonly level: number;
  /** 地区の中心の画面座標 */
  readonly at: Point2D;
  readonly isLordMe: boolean;
  /** 領主の名前（主なしなら無し） */
  readonly lordName?: string;
  readonly lordLost: boolean;
  /** 領主のアバターの画像（主なし・作れないときは無し） */
  readonly avatar?: AvatarSprite;
  readonly mood: DistrictMood;
  readonly fadeAlpha: number;
  readonly fadeTag?: string;
}

/** 描いた台座（当たり判定用） */
export interface PlacedTower {
  readonly districtId: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 自分のアバターをよけるための入力。
 * 自分の位置は動かさない（2026-11-10 ユーザー指摘「ズームと同時に自分のアイコンの位置がずれていく」）ので、
 * 自分が領主・王冠・旗・紙札に重なる地区では、台座のほうを横へずらして描く（台座は地区の印で、実際の位置を持たない）。
 */
export interface TowerDodge {
  /** 自分のアバターと「あなた」の札が占める矩形（画面座標） */
  readonly self: BannerBox;
  /** 画面の幅（ずらした台座を画面の外へ出さない。CSS px） */
  readonly width: number;
  /** 地区ID → いまのずれ（CSS px。フレームをまたいで覚え、少しずつ寄せる。広域を出たら呼び出し側で空にする） */
  readonly state: Map<string, number>;
}

/** 自分と、ずらした台座のあいだに空ける幅（CSS px） */
const DODGE_GAP_PX = 6;
/** ずらした台座と、ほかの台座のあいだに空ける幅（CSS px） */
const DODGE_NEIGHBOR_GAP_PX = 8;

/**
 * 台座の大きさ（引いて見るほど少し小さく）。
 * @param metersPerPx 縮尺
 * @returns 倍率
 */
export function towerScaleOf(metersPerPx: number): number { // audit-ignore: fnlog-missing 毎フレーム描画
  return Math.min(1.08, Math.max(0.78, 3.4 / Math.max(0.1, metersPerPx)));
}

/**
 * すべての台座を描く（奥＝画面の上のものから順に）。
 * @param ctx 2D コンテキスト
 * @param towers 台座
 * @param t 現在時刻（ミリ秒）
 * @param textScale 文字の拡大率
 * @param k 大きさ（towerScaleOf）
 * @param dodge 自分のアバターをよける入力（無ければずらさない）
 * @returns 描いた台座（当たり判定用）
 * @sideEffect canvas に描く。dodge.state を更新する
 */
export function drawChampionTowers(ctx: CanvasRenderingContext2D, towers: readonly ChampionTowerInput[], t: number, textScale: number, k: number, dodge?: TowerDodge): PlacedTower[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const placed: PlacedTower[] = [];
  const shifts = dodge === undefined ? undefined : towerShifts(ctx, towers, dodge, textScale, k);
  for (const tower of [...towers].sort((a, b) => a.at.y - b.at.y)) placed.push(drawTower(ctx, tower, t, textScale, k, shifts?.get(tower.districtId) ?? 0));
  return placed;
}

/**
 * 台座の部品（領主と王冠・石の台座・旗と紙札・色あせのタグ）が占めるおおよその矩形を、描く前に求める。
 * 旗と紙札の幅は districtBanners の drawDistrictRibbon と同じ式。
 * @param ctx 2D コンテキスト（文字の幅を測る）
 * @param tower 台座
 * @param textScale 文字の拡大率
 * @param k 大きさ
 * @returns 矩形（画面座標。ずらす前の位置）
 */
function towerParts(ctx: CanvasRenderingContext2D, tower: ChampionTowerInput, textScale: number, k: number): BannerBox[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const fx = tower.at.x;
  const fy = tower.at.y + 6 * k;
  const standY = fy - 21 * k;
  const a = tower.lordName === undefined ? undefined : tower.avatar;
  const lordHalf = a === undefined ? 14 * k : Math.max(a.footX, a.width - a.footX, 9 * k);
  // 王冠は頭の上に 17k ほど浮く（揺れのぶんを足す）。主なしは「？」の玉
  const lordTop = a === undefined ? standY - 32 * k : standY - a.footY - 20 * k;
  ctx.save();
  ctx.font = canvasFont(13 * k, 800, textScale);
  const ribbonW = ctx.measureText(tower.name).width + 22 * k * textScale + (tower.isLordMe ? 16 * k : 0) + 26 * k;
  ctx.font = canvasFont(10 * k, 800, textScale);
  const tagW = tower.lordName === undefined ? 0 : Math.min(ctx.measureText(tower.lordName).width, 96 * k) + 26 * k + (tower.lordLost ? 30 * k : 0);
  ctx.font = canvasFont(11, 700, textScale);
  const fadeW = tower.fadeTag === undefined ? 0 : ctx.measureText(tower.fadeTag).width + 12;
  ctx.restore();
  const labelW = Math.max(ribbonW, tagW);
  const labelTop = fy + 9 * k;
  const parts: BannerBox[] = [
    { x: fx - lordHalf, y: lordTop, w: lordHalf * 2, h: standY - lordTop },
    { x: fx - 31 * k, y: standY - 6 * k, w: 62 * k, h: 36 * k },
    { x: fx - labelW / 2, y: labelTop, w: labelW, h: (tower.lordName === undefined ? 22 : 39) * k * textScale + 6 * k },
  ];
  if (fadeW > 0) parts.push({ x: fx + ribbonW / 2 - 6 * k - fadeW / 2, y: labelTop + 2 * k * textScale - 17 * textScale, w: fadeW, h: 17 * textScale });
  return parts;
}

/**
 * 自分のアバターをよけるために、各台座を横へずらす幅を決める（重ならない台座は 0）。
 * @param ctx 2D コンテキスト
 * @param towers 台座
 * @param dodge 自分の矩形・画面の幅・覚えているずれ
 * @param textScale 文字の拡大率
 * @param k 大きさ
 * @returns 地区ID → ずらす幅（CSS px）
 * @sideEffect dodge.state を更新する
 */
function towerShifts(ctx: CanvasRenderingContext2D, towers: readonly ChampionTowerInput[], dodge: TowerDodge, textScale: number, k: number): Map<string, number> { // audit-ignore: fnlog-missing 毎フレーム描画
  const parts = new Map<string, BannerBox[]>();
  for (const tower of towers) parts.set(tower.districtId, towerParts(ctx, tower, textScale, k));
  const out = new Map<string, number>();
  for (const tower of towers) {
    const id = tower.districtId;
    const prev = dodge.state.get(id);
    const others: BannerBox[] = [];
    for (const [otherId, boxes] of parts) if (otherId !== id) others.push(...boxes);
    const target = dodgeTarget(parts.get(id) ?? [], others, dodge, prev ?? 0);
    // 広域に入った最初のフレームはそのまま置き、あとは少しずつ寄せる（台座が跳ばないように）
    const next = prev === undefined || Math.abs(target - prev) < 0.5 ? target : prev + (target - prev) * 0.2;
    dodge.state.set(id, next);
    out.set(id, next);
  }
  return out;
}

/**
 * 台座1つをずらす幅を決める。向きは動きの小さいほう（前のフレームでずらしていればその向き）。
 * ほかの台座にぶつかる・画面から出るなら反対側。
 * @param own その台座の部品の矩形（ずらす前）
 * @param others ほかの台座の部品の矩形
 * @param dodge 自分の矩形・画面の幅
 * @param prev 前のフレームのずれ（向きを保つ）
 * @returns ずらす幅（CSS px。重ならなければ 0）
 */
function dodgeTarget(own: readonly BannerBox[], others: readonly BannerBox[], dodge: TowerDodge, prev: number): number { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = dodge.self;
  const rows = own.filter((r) => r.y < s.y + s.h && r.y + r.h > s.y);
  if (!rows.some((r) => r.x < s.x + s.w && r.x + r.w > s.x)) return 0;
  const right = Math.max(...rows.map((r) => s.x + s.w + DODGE_GAP_PX - r.x));
  const left = Math.min(...rows.map((r) => s.x - DODGE_GAP_PX - (r.x + r.w)));
  const order = prev < 0 || (prev === 0 && -left < right) ? [left, right] : [right, left];
  /**
   * ずらした先が画面の中に収まるか。
   * @param dx ずらす幅
   * @returns 収まれば true
   */
  const inside = (dx: number): boolean => own.every((r) => r.x + dx >= 4 && r.x + r.w + dx <= dodge.width - 4); // audit-ignore: fnlog-missing 毎フレーム描画
  /**
   * ずらした先が、ほかの台座から離れているか。
   * @param dx ずらす幅
   * @returns 離れていれば true
   */
  const clear = (dx: number): boolean => !own.some((r) => others.some((o) => r.x + dx < o.x + o.w + DODGE_NEIGHBOR_GAP_PX && r.x + r.w + dx > o.x - DODGE_NEIGHBOR_GAP_PX && r.y < o.y + o.h && r.y + r.h > o.y)); // audit-ignore: fnlog-missing 毎フレーム描画
  return order.find((dx) => inside(dx) && clear(dx)) ?? order.find((dx) => inside(dx)) ?? 0;
}

/**
 * 台座の当たり判定（上に描いたもの＝画面の下のものを優先）。
 * @param placed 描いた台座
 * @param p タップした点
 * @returns 地区ID（当たらなければ undefined）
 */
export function hitTestTower(placed: readonly PlacedTower[], p: Point2D): string | undefined { // audit-ignore: fnlog-missing タップごとの小さな判定
  for (let i = placed.length - 1; i >= 0; i--) {
    const r = placed[i];
    if (r !== undefined && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r.districtId;
  }
  return undefined;
}

/**
 * 台座を1つ描く（影 → 後光 → 台座 → アバター → 王冠 → 旗）。
 * @param ctx 2D コンテキスト
 * @param tower 台座
 * @param t 現在時刻
 * @param textScale 文字の拡大率
 * @param k 大きさ
 * @param dx 横へずらす幅（自分のアバターをよけるとき。CSS px）
 * @returns 描いた範囲
 * @sideEffect canvas に描く
 */
function drawTower(ctx: CanvasRenderingContext2D, tower: ChampionTowerInput, t: number, textScale: number, k: number, dx: number): PlacedTower { // audit-ignore: fnlog-missing 毎フレーム描画
  const fx = tower.at.x + dx;
  const fy = tower.at.y + 6 * k;
  const standY = fy - 21 * k;
  const hasLord = tower.lordName !== undefined;
  ctx.save();
  ctx.globalAlpha = Math.max(0.65, tower.fadeAlpha);
  // 影
  ctx.fillStyle = toRgba(PALETTE.ink, 0.2);
  ctx.beginPath();
  ctx.ellipse(fx, fy + 2 * k, 31 * k, 8 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  drawAura(ctx, tower, { x: fx, y: standY - 18 * k }, t, k);
  drawPedestal(ctx, tower, fx, fy, k, t);
  const bob = Math.sin(t / 620 + tower.at.x * 0.05) * 1.4 * k;
  let headTop = standY - 40 * k;
  if (tower.avatar !== undefined && hasLord) {
    const a = tower.avatar;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(a.image, fx - a.footX, standY - a.footY + bob, a.width, a.height);
    ctx.imageSmoothingEnabled = true;
    headTop = standY - a.footY + bob + a.height * 0.08;
  } else drawVacant(ctx, fx, standY, k, t);
  if (hasLord) headTop = drawFloatingCrown(ctx, fx, headTop, tower.isLordMe, t, k);
  ctx.restore();
  const box = drawDistrictRibbon(
    ctx,
    { x: fx, y: fy + 9 * k },
    {
      name: tower.name,
      color: tower.color,
      level: tower.level,
      isLordMe: tower.isLordMe,
      ...(tower.lordName === undefined ? {} : { lordName: tower.lordName }),
      lordLost: tower.lordLost,
      ...(tower.fadeTag === undefined ? {} : { fadeTag: tower.fadeTag }),
      alpha: tower.fadeAlpha,
    },
    textScale,
    k,
  );
  const left = Math.min(fx - 34 * k, box.x);
  const right = Math.max(fx + 34 * k, box.x + box.w);
  return { districtId: tower.districtId, x: left, y: headTop, w: right - left, h: box.y + box.h - headTop };
}

/**
 * 領主の頭の上に浮かぶ王冠（光る。自分ならきらめき付き）。
 * @param ctx 2D コンテキスト
 * @param fx 中心の x
 * @param headTop 頭のてっぺんの y
 * @param mine 自分が領主か
 * @param t 現在時刻
 * @param k 大きさ
 * @returns 王冠の上端の y（当たり判定の上端）
 * @sideEffect canvas に描く
 */
function drawFloatingCrown(ctx: CanvasRenderingContext2D, fx: number, headTop: number, mine: boolean, t: number, k: number): number { // audit-ignore: fnlog-missing 毎フレーム描画
  const cy = headTop - 9 * k + Math.sin(t / 480) * 1.8 * k;
  ctx.save();
  ctx.shadowColor = toRgba(PALETTE.glow, 0.9);
  ctx.shadowBlur = 10 * k;
  drawCrownGlyph(ctx, fx, cy, 0.95 * k);
  ctx.restore();
  if (mine) drawTwinkles(ctx, fx, cy, t, k);
  return cy - 8 * k;
}

/**
 * 台座の後ろの光（自分＝金の後光と回る光の筋、ライバル＝紫の揺らぐ気配、主なし＝白いもや）。
 * @param ctx 2D コンテキスト
 * @param tower 台座
 * @param c 光の中心
 * @param t 現在時刻
 * @param k 大きさ
 * @sideEffect canvas に描く
 */
function drawAura(ctx: CanvasRenderingContext2D, tower: ChampionTowerInput, c: Point2D, t: number, k: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const hasLord = tower.lordName !== undefined;
  const color = tower.isLordMe ? PALETTE.glow : hasLord ? TERRITORY_RIVAL_COLOR : PALETTE.white;
  const pulse = 0.85 + Math.sin(t / 700 + c.x) * 0.15;
  const r = 38 * k * pulse;
  const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, r);
  g.addColorStop(0, toRgba(color, tower.isLordMe ? 0.75 : 0.5));
  g.addColorStop(1, toRgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  if (!tower.isLordMe) return;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(t / 4200);
  ctx.fillStyle = toRgba(PALETTE.glow, 0.28);
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-4 * k, -44 * k);
    ctx.lineTo(4 * k, -44 * k);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 2段の丸い石の台座（上の段に地区の色の帯）。にぎやかな地区は足もとに花、廃れ気味はひびと雑草。
 * @param ctx 2D コンテキスト
 * @param tower 台座
 * @param fx 足もとの中心
 * @param fy 足もとの下端
 * @param k 大きさ
 * @param t 現在時刻
 * @sideEffect canvas に描く
 */
function drawPedestal(ctx: CanvasRenderingContext2D, tower: ChampionTowerInput, fx: number, fy: number, k: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const decaying = tower.mood === 'decaying';
  const top = decaying ? shade(STONE.top, -0.08) : STONE.top;
  const side = decaying ? shade(STONE.side, -0.12) : STONE.side;
  // 下の段
  drawDrum(ctx, fx, fy, 27 * k, 7 * k, 11 * k, side, top);
  // 上の段（地区の色の帯）
  const band = decaying ? shade(tower.color, -0.3) : tower.color;
  drawDrum(ctx, fx, fy - 11 * k, 19 * k, 5.2 * k, 10 * k, band, shade(band, 0.55));
  ctx.strokeStyle = PALETTE.metalGold;
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.ellipse(fx, fy - 13 * k, 19 * k, 5.2 * k, 0, 0.05 * Math.PI, 0.95 * Math.PI);
  ctx.stroke();
  if (decaying) {
    ctx.strokeStyle = STONE.crack;
    ctx.lineWidth = 1 * k;
    ctx.beginPath();
    ctx.moveTo(fx - 12 * k, fy - 10 * k);
    ctx.lineTo(fx - 9 * k, fy - 6 * k);
    ctx.lineTo(fx - 11 * k, fy - 3 * k);
    ctx.lineTo(fx - 8 * k, fy + 1 * k);
    ctx.stroke();
    ctx.fillStyle = WEED;
    for (const dx of [-24, -19, 21, 25]) {
      ctx.fillRect(fx + dx * k, fy - 3 * k, 1.4 * k, 5 * k);
      ctx.fillRect(fx + (dx + 1.6) * k, fy - 1.5 * k, 1.4 * k, 3.5 * k);
    }
    return;
  }
  if (tower.mood !== 'lively') return;
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * (0.15 + (i / 5) * 0.7);
    const x = fx - Math.cos(a) * 29 * k;
    const y = fy - 1 * k + Math.sin(a) * 6 * k;
    const sway = Math.sin(t / 500 + i) * 0.6 * k;
    ctx.fillStyle = FLOWERS[i % FLOWERS.length] ?? PALETTE.white;
    ctx.beginPath();
    ctx.arc(x + sway, y, 2.2 * k, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 円柱（上面の楕円＋側面）を描く。
 * @param ctx 2D コンテキスト
 * @param cx 中心
 * @param bottom 底の楕円の中心の y
 * @param rx 横の半径
 * @param ry 縦の半径
 * @param height 高さ
 * @param side 側面の色
 * @param topColor 上面の色
 * @sideEffect canvas に描く
 */
function drawDrum(ctx: CanvasRenderingContext2D, cx: number, bottom: number, rx: number, ry: number, height: number, side: string, topColor: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.ellipse(cx, bottom, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - rx, bottom - height);
  ctx.ellipse(cx, bottom - height, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = toRgba(STONE.edge, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = topColor;
  ctx.beginPath();
  ctx.ellipse(cx, bottom - height, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * 主なしの台座（「？」の浮かぶ光の玉）。
 * @param ctx 2D コンテキスト
 * @param fx 中心
 * @param standY 台座の上面
 * @param k 大きさ
 * @param t 現在時刻
 * @sideEffect canvas に描く
 */
function drawVacant(ctx: CanvasRenderingContext2D, fx: number, standY: number, k: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const y = standY - 16 * k + Math.sin(t / 700) * 2 * k;
  ctx.fillStyle = toRgba(PALETTE.white, 0.78);
  ctx.strokeStyle = toRgba(PALETTE.mutedInk, 0.6);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(fx, y, 13 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = PALETTE.mutedInk;
  ctx.font = canvasFont(15 * k, 800, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('？', fx, y + 1);
}

/**
 * 自分が領主の台座の王冠のまわりのきらめき。
 * @param ctx 2D コンテキスト
 * @param x 王冠の中心
 * @param y 王冠の中心
 * @param t 現在時刻
 * @param k 大きさ
 * @sideEffect canvas に描く
 */
function drawTwinkles(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, k: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (let i = 0; i < 3; i++) {
    const phase = (t / 900 + i / 3) % 1;
    const a = i * 2.1 + t / 2600;
    const px = x + Math.cos(a) * 15 * k;
    const py = y + Math.sin(a) * 7 * k - 2 * k;
    const s = Math.sin(phase * Math.PI) * 3.2 * k;
    if (s <= 0.2) continue;
    ctx.fillStyle = toRgba(PALETTE.white, 0.95);
    ctx.beginPath();
    ctx.moveTo(px, py - s);
    ctx.lineTo(px + s * 0.3, py - s * 0.3);
    ctx.lineTo(px + s, py);
    ctx.lineTo(px + s * 0.3, py + s * 0.3);
    ctx.lineTo(px, py + s);
    ctx.lineTo(px - s * 0.3, py + s * 0.3);
    ctx.lineTo(px - s, py);
    ctx.lineTo(px - s * 0.3, py - s * 0.3);
    ctx.closePath();
    ctx.fill();
  }
}
