/**
 * @file マイ街の街並み（横スクロールのヒーロー）の描画（presentation/screens/MyTown 層。Canvas 描画の純粋関数）
 * 絵は docs/08 §10.5 のフラットなモダン都市イラスト（淡い空色のグラデ・遠景のビル群・窓のグリッドのビル・ガラスの店先・地区色の日よけ・街路樹・街灯）。
 * 部品は townPieceArt（shared/cityArt・landmarkArt）で描き、文字・吹き出しはその上に重ねる（白い角丸＋影）。
 * 5地区を左から順に並べ、訪れた分だけ建物を描く（低層の店 → 中層 → 高層）。まだ建っていない場所は点線の枠で「これから建つ」を示す。
 * 街が生きて見えるように: 雲が流れる、Lv3 の地区はライトアップ（窓の灯り・街灯・電球の列）、川辺に桜が舞う、今日訪れた地区がきらめく、色あせた地区は「待ってるよ」。
 * 色あせは地区ごとに ctx.filter で彩度を落とすだけ（建物は減らさない＝CLAUDE.md 4.3）。未訪問の地区は無彩色＋「？」。
 * 状態・タイマーは持たない。スクロール位置・時刻は呼び出し側（TownStrip）が vm で渡す（docs/03 §7）。
 */
import { mixColors } from '@/Common/ui/canvas/colorUtils';
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import { PALETTE } from '@/Common/ui/theme/palette';
import { drawAvatar } from '@/presentation/screens/MyTown/avatarArt';
import type { AvatarLook } from '@/presentation/screens/MyTown/avatarArt';
import type { SceneKind } from '@/presentation/screens/MyTown/myTownModel';
import { paintTownPiece } from '@/presentation/screens/MyTown/townPieceArt';
import { DISTRICT_WIDTH_PX, GROUND_Y_PX, ROAD_Y_PX, SCENES, STRIP_HEIGHT_PX } from '@/presentation/screens/MyTown/townScenes';
import type { Piece, SceneBackground } from '@/presentation/screens/MyTown/townScenes';
import { colorTone, FAR_SKYLINE, FAR_SKYLINE_NEAR, fillBox, hash2, paintCloud, paintFarSkyline, paintSky, paintStreetLamp } from '@/presentation/shared/cityArt';
import type { CityTone } from '@/presentation/shared/cityArt';

/** 街並みの地面・道・文字の色（docs/08 §10.2 のクールグレー） */
const STREET = {
  sidewalk: '#eef1f5',
  sidewalkUnvisited: '#eceef1',
  road: '#e5e8ed',
  lane: '#ffffff',
  curbUnvisited: '#c9ced6',
  ghost: '#9ca3af',
  water: '#a8d8f4',
  waterDeep: '#8cc8ec',
} as const;

/** 飾り（花びら・きらめき・点線）の大きさの単位（CSS px） */
const DECOR_UNIT = 2;

/** 街並みに描く1地区 */
export interface StripDistrictVm {
  readonly name: string;
  /** 地区の色 '#rrggbb' */
  readonly color: string;
  readonly scene: SceneKind;
  /** 建っている部品の数（0..SCENE_SLOT_COUNT） */
  readonly builtSlots: number;
  /** ctx.filter（色あせ） */
  readonly filter: string;
  readonly isUnvisited: boolean;
  /** 成長段階 0..3（3 で祭りの旗） */
  readonly level: number;
  /** 今日訪れた（きらめき） */
  readonly visitedToday: boolean;
  /** 色あせ間近・色あせ中（「待ってるよ」の吹き出し） */
  readonly isWaiting: boolean;
  /** ラベルに添える状態（色あせ間近など。無ければ undefined） */
  readonly note?: string;
}

/** 街並み全体の描画モデル */
export interface TownStripVm {
  readonly width: number;
  readonly height: number;
  /** 左端のスクロール位置（CSS px） */
  readonly scrollX: number;
  /** 経過時間（ms。動きを減らす設定なら 0 固定） */
  readonly time: number;
  readonly districts: readonly StripDistrictVm[];
  /** アバターが立つ地区のインデックス */
  readonly avatarIndex: number;
  readonly avatarLook: AvatarLook;
  /** アバターのセリフ（無ければ吹き出しを出さない） */
  readonly avatarSay?: string;
  /** 文字拡大の係数 */
  readonly textScale: number;
}

/**
 * 地区の色と成長段階から部品の色一式を作る（Lv3 はライトアップ）。
 * @param d 地区
 * @returns 色一式
 */
function toneOf(d: StripDistrictVm): CityTone { // audit-ignore: fnlog-missing 毎フレーム描画
  return colorTone(d.color, { lit: d.level >= 3 });
}

/**
 * 地面より上の空の高さ（ヒーローが街並みより高いとき、その分だけ空を広げる）。
 * @param vm 描画モデル
 * @returns 下へずらす量（CSS px）
 */
function skyOffsetOf(vm: TownStripVm): number { // audit-ignore: fnlog-missing 毎フレーム描画
  return Math.max(0, vm.height - STRIP_HEIGHT_PX);
}

/**
 * 空（淡い空色のグラデ）・やわらかな日差し・流れる雲・遠景のビル群（2層のパララックス）を描く。
 * @param ctx 描画先
 * @param vm 描画モデル
 */
function drawSky(ctx: CanvasRenderingContext2D, vm: TownStripVm): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const off = skyOffsetOf(vm);
  const horizon = GROUND_Y_PX + off;
  paintSky(ctx, [0, 0, vm.width, horizon + 1]);
  const sun = ctx.createRadialGradient(vm.width - 56, 42, 0, vm.width - 56, 42, 90);
  sun.addColorStop(0, 'rgba(255, 247, 214, 0.95)');
  sun.addColorStop(1, 'rgba(255, 247, 214, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(vm.width - 146, 0, 180, 130);
  for (let i = 0; i < 4; i++) {
    const span = vm.width + 160;
    const x = (((i * 190 + vm.time * 0.012 - vm.scrollX * 0.15) % span) + span) % span - 84;
    paintCloud(ctx, x, 34 + (i % 2) * 24 + (i === 3 ? 18 : 0), 44 + (i % 3) * 14);
  }
  const range = { from: 0, to: vm.width };
  paintFarSkyline(ctx, range, { base: horizon, offset: vm.scrollX * 0.25, color: FAR_SKYLINE, minH: 46, maxH: 104, seed: 11, unit: 26 });
  paintFarSkyline(ctx, range, { base: horizon, offset: vm.scrollX * 0.45, color: FAR_SKYLINE_NEAR, minH: 24, maxH: 62, seed: 29, unit: 20 });
}

/**
 * 地区の歩道と背景（川など）を描く。歩道の縁に地区色の線（未訪問は灰色の破線）。
 * @param ctx 描画先
 * @param x0 地区の左端
 * @param d 地区
 * @param background 背景の種類
 */
function drawGround(ctx: CanvasRenderingContext2D, x0: number, d: StripDistrictVm, background: SceneBackground): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const W = DISTRICT_WIDTH_PX;
  fillBox(ctx, [x0, GROUND_Y_PX, W, ROAD_Y_PX - GROUND_Y_PX], d.isUnvisited ? STREET.sidewalkUnvisited : STREET.sidewalk);
  if (background === 'river' || background === 'sea') {
    fillBox(ctx, [x0, GROUND_Y_PX + 6, W, ROAD_Y_PX - GROUND_Y_PX - 10], STREET.water);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    for (let i = 0; i < 6; i++) ctx.fillRect(x0 + 12 + i * 32 + (i % 2) * 8, GROUND_Y_PX + 14 + (i % 3) * 6, 14, 1.5);
    fillBox(ctx, [x0, ROAD_Y_PX - 4, W, 4], STREET.waterDeep);
  }
  ctx.save();
  if (d.isUnvisited) {
    ctx.strokeStyle = STREET.curbUnvisited; ctx.lineWidth = 2; ctx.setLineDash([DECOR_UNIT * 3, DECOR_UNIT * 2]);
  } else {
    ctx.strokeStyle = d.color; ctx.lineWidth = 3;
  }
  ctx.beginPath(); ctx.moveTo(x0, GROUND_Y_PX + 1); ctx.lineTo(x0 + W, GROUND_Y_PX + 1); ctx.stroke();
  ctx.restore();
}

/**
 * まだ建っていない場所を点線の枠（区画線）で描く。
 * @param ctx 描画先
 * @param x0 地区の左端
 * @param piece 部品の置き方
 */
function drawGhost(ctx: CanvasRenderingContext2D, x0: number, piece: Piece): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (piece.kind === 'lamp') return;
  ctx.save();
  ctx.strokeStyle = STREET.ghost;
  ctx.lineWidth = 1;
  ctx.setLineDash([DECOR_UNIT * 2, DECOR_UNIT * 2]);
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.roundRect(x0 + piece.x + 0.5, GROUND_Y_PX - (piece.base ?? 0) - piece.h + 0.5, piece.w - 1, piece.h - 1, 3);
  ctx.stroke();
  ctx.restore();
}

/**
 * Lv3 の地区をライトアップする（「名所に装飾」＝CLAUDE.md 4.3）。名所の後ろの温かい光と、街灯の間に渡した電球の列。
 * @param ctx 描画先
 * @param x0 地区の左端
 * @param time 経過時間（電球が少しまたたく）
 */
function drawLightUp(ctx: CanvasRenderingContext2D, x0: number, time: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const y = GROUND_Y_PX - 52;
  ctx.save();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0 + 18, y); ctx.quadraticCurveTo(x0 + 100, y + 22, x0 + 182, y); ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const t = (i + 0.5) / 12;
    const bx = x0 + 18 + 164 * t;
    const by = y + 22 * 2 * t * (1 - t) + 3;
    const on = 0.65 + 0.35 * Math.sin(time / 380 + i * 1.3);
    const glow = ctx.createRadialGradient(bx, by, 0, bx, by, 7);
    glow.addColorStop(0, `rgba(253, 230, 138, ${(0.7 * on).toFixed(2)})`);
    glow.addColorStop(1, 'rgba(253, 230, 138, 0)');
    ctx.fillStyle = glow; ctx.fillRect(bx - 7, by - 7, 14, 14);
    ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(bx, by, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/**
 * 名所の後ろの温かい光（Lv3 のライトアップ。建物より先に描く）。
 * @param ctx 描画先
 * @param x0 地区の左端
 */
function drawLandmarkGlow(ctx: CanvasRenderingContext2D, x0: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const cx = x0 + DISTRICT_WIDTH_PX / 2;
  const glow = ctx.createRadialGradient(cx, GROUND_Y_PX, 0, cx, GROUND_Y_PX, 110);
  glow.addColorStop(0, 'rgba(253, 230, 138, 0.55)');
  glow.addColorStop(1, 'rgba(253, 230, 138, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x0, GROUND_Y_PX - 110, DISTRICT_WIDTH_PX, 110);
}

/**
 * 川辺の桜吹雪（時間で落ちる花びら。小さな楕円）を描く。
 * @param ctx 描画先
 * @param x0 地区の左端
 * @param time 経過時間
 */
function drawPetals(ctx: CanvasRenderingContext2D, x0: number, time: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = '#f9a8d4';
  for (let i = 0; i < 10; i++) {
    const fall = ((time * 0.02 + i * 23) % 150);
    const px = x0 + ((i * 37 + Math.sin(time / 700 + i) * 12) % DISTRICT_WIDTH_PX);
    ctx.beginPath(); ctx.ellipse(px, 40 + fall, DECOR_UNIT * 1.4, DECOR_UNIT * 0.8, (time / 600 + i) % Math.PI, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * 今日訪れた地区のきらめき（明滅する4方向の星）を描く。
 * @param ctx 描画先
 * @param x0 地区の左端
 * @param time 経過時間
 */
function drawSparkles(ctx: CanvasRenderingContext2D, x0: number, time: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = PALETTE.gold;
  const spots: readonly (readonly [number, number])[] = [[40, 70], [150, 60], [100, 40], [176, 110], [22, 120]];
  spots.forEach(([sx, sy], i) => {
    const s = Math.sin(time / 260 + i * 1.7);
    if (s < 0.1) return;
    const r = DECOR_UNIT * (1.5 + s * 1.5);
    const k = r * 0.25;
    const x = x0 + sx;
    ctx.beginPath();
    ctx.moveTo(x, sy - r); ctx.lineTo(x + k, sy - k); ctx.lineTo(x + r, sy); ctx.lineTo(x + k, sy + k);
    ctx.lineTo(x, sy + r); ctx.lineTo(x - k, sy + k); ctx.lineTo(x - r, sy); ctx.lineTo(x - k, sy - k);
    ctx.closePath(); ctx.fill();
  });
}

/**
 * 1地区を描く（歩道・これから建つ枠・建った部品・街灯・飾り）。色あせは filter で地区ごとに掛ける（形は残す）。
 * @param ctx 描画先
 * @param x0 地区の左端
 * @param d 地区
 * @param time 経過時間
 */
function drawDistrict(ctx: CanvasRenderingContext2D, x0: number, d: StripDistrictVm, time: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const scene = SCENES[d.scene];
  const tone = toneOf(d);
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, -400, DISTRICT_WIDTH_PX, ROAD_Y_PX + 400); ctx.clip();
  ctx.filter = d.filter;
  drawGround(ctx, x0, d, scene.background);
  if (d.level >= 3) drawLandmarkGlow(ctx, x0);
  scene.pieces.slice(d.builtSlots).forEach((piece) => drawGhost(ctx, x0, piece));
  const built = scene.pieces.slice(0, d.builtSlots).map((piece, order) => ({ piece, order }));
  built.sort((a, b) => a.piece.z - b.piece.z || a.order - b.order);
  for (const { piece, order } of built) {
    paintTownPiece(ctx, piece.kind, { x: x0 + piece.x, base: GROUND_Y_PX - (piece.base ?? 0), w: piece.w, h: piece.h }, tone, hash2(x0 + piece.x, order));
  }
  if (d.builtSlots > 0 && scene.background === 'plain') {
    paintStreetLamp(ctx, x0 + 24, ROAD_Y_PX - 4, 60, tone);
    paintStreetLamp(ctx, x0 + 168, ROAD_Y_PX - 4, 60, tone);
  }
  if (d.level >= 3) drawLightUp(ctx, x0, time);
  if (d.scene === 'riverside' && !d.isUnvisited) drawPetals(ctx, x0, time);
  ctx.restore();
  if (d.visitedToday) drawSparkles(ctx, x0, time);
}

/**
 * 街の絵（文字以外すべて）を描く：空 → 地区ごとの街並み → 道路 → アバター。
 * @param ctx 描画先（CSS px 座標）
 * @param vm 描画モデル
 */
function drawWorld(ctx: CanvasRenderingContext2D, vm: TownStripVm): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  drawSky(ctx, vm);
  const worldWidth = DISTRICT_WIDTH_PX * vm.districts.length;
  ctx.save();
  ctx.translate(-vm.scrollX, skyOffsetOf(vm));
  vm.districts.forEach((d, i) => {
    const x0 = i * DISTRICT_WIDTH_PX;
    if (x0 + DISTRICT_WIDTH_PX < vm.scrollX || x0 > vm.scrollX + vm.width) return;
    drawDistrict(ctx, x0, d, vm.time);
  });
  fillBox(ctx, [0, ROAD_Y_PX, worldWidth, vm.height], STREET.road);
  fillBox(ctx, [0, ROAD_Y_PX, worldWidth, 3], '#ffffff');
  ctx.fillStyle = STREET.lane;
  for (let x = 6; x < worldWidth; x += 28) ctx.fillRect(x, ROAD_Y_PX + 22, 14, DECOR_UNIT);
  const bob = Math.sin(vm.time / 320) * 1.2;
  drawAvatar(ctx, vm.avatarLook, { x: avatarXOf(vm), y: 244 - Math.max(0, bob), scale: 0.9 });
  ctx.restore();
}

/**
 * アバターの足元の X（世界座標）。
 * @param vm 描画モデル
 * @returns X
 */
function avatarXOf(vm: TownStripVm): number { // audit-ignore: fnlog-missing 毎フレーム描画
  return vm.avatarIndex * DISTRICT_WIDTH_PX + DISTRICT_WIDTH_PX / 2 + 30;
}

/**
 * 吹き出し（白〔または強調色〕の角丸＋小さなしっぽ＋やわらかい影）を描く。
 * @param ctx 描画先
 * @param text 文字
 * @param at しっぽの先の位置と、はみ出さない範囲
 * @param style 文字の大きさ・強調色（指定時は白文字）・文字拡大の係数
 */
function drawBubble(ctx: CanvasRenderingContext2D, text: string, at: { readonly x: number; readonly y: number; readonly minX: number; readonly maxX: number }, style: { readonly size: number; readonly accent?: string; readonly scale: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (at.x < at.minX || at.x > at.maxX) return;
  ctx.save();
  ctx.font = canvasFont(style.size, 700, style.scale);
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  const hgt = Math.round(style.size * style.scale) + 12;
  const left = Math.round(Math.min(Math.max(at.x - w / 2, at.minX + 4), at.maxX - w - 4));
  const top = Math.round(at.y - hgt - 6);
  const tail = Math.round(Math.min(Math.max(at.x, left + 12), left + w - 12));
  ctx.shadowColor = 'rgba(17, 24, 39, 0.16)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  ctx.fillStyle = style.accent ?? '#ffffff';
  ctx.beginPath(); ctx.roundRect(left, top, w, hgt, hgt / 2); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath(); ctx.moveTo(tail - 5, top + hgt - 1); ctx.lineTo(tail + 5, top + hgt - 1); ctx.lineTo(tail, top + hgt + 5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = style.accent === undefined ? PALETTE.ink : '#ffffff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, left + w / 2, top + hgt / 2 + 0.5);
  ctx.restore();
}

/**
 * 地区名のラベル（白いピル＋影小・地区色の点）を描く（docs/08 §10.4 のラベルと同じ形）。
 * @param ctx 描画先
 * @param cx 中心 X
 * @param d 地区
 * @param at ラベルの上端と文字拡大の係数
 */
function drawLabel(ctx: CanvasRenderingContext2D, cx: number, d: StripDistrictVm, at: { readonly top: number; readonly textScale: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(12, 700, at.textScale);
  const w = Math.ceil(ctx.measureText(d.name).width) + 30;
  const hgt = Math.round(12 * at.textScale) + 12;
  const left = Math.round(cx - w / 2);
  ctx.shadowColor = 'rgba(17, 24, 39, 0.14)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.roundRect(left, at.top, w, hgt, hgt / 2); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = d.isUnvisited ? STREET.ghost : d.color;
  ctx.beginPath(); ctx.arc(left + 12, at.top + hgt / 2, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = d.isUnvisited ? PALETTE.mutedInk : PALETTE.ink;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(d.name, cx + 6, at.top + hgt / 2 + 0.5);
  ctx.restore();
}

/**
 * 文字（地区名・「待ってるよ」・アバターのセリフ・「？」）を絵の上に重ねる。
 * @param ctx 描画先
 * @param vm 描画モデル
 */
function drawOverlay(ctx: CanvasRenderingContext2D, vm: TownStripVm): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const off = skyOffsetOf(vm);
  const view = { minX: vm.scrollX, maxX: vm.scrollX + vm.width };
  ctx.save();
  ctx.translate(-vm.scrollX, 0);
  vm.districts.forEach((d, i) => {
    const cx = i * DISTRICT_WIDTH_PX + DISTRICT_WIDTH_PX / 2;
    drawLabel(ctx, cx, d, { top: off + 58, textScale: vm.textScale });
    if (d.isUnvisited) drawBubble(ctx, '？ まだ霧の中', { x: cx, y: off + 122, ...view }, { size: 11, scale: vm.textScale });
    else if (d.isWaiting) drawBubble(ctx, '待ってるよ', { x: cx - 34, y: off + 104 + Math.sin(vm.time / 500 + i) * 2, ...view }, { size: 11, accent: PALETTE.brandInk, scale: vm.textScale });
    else if (d.visitedToday) drawBubble(ctx, '今日 訪れた！', { x: cx - 34, y: off + 104, ...view }, { size: 11, accent: '#047857', scale: vm.textScale });
  });
  if (vm.avatarSay !== undefined) drawBubble(ctx, vm.avatarSay, { x: avatarXOf(vm) + 4, y: off + 172, ...view }, { size: 12, scale: vm.textScale });
  ctx.restore();
}

/**
 * 街並み全体を描く（絵の上に文字・吹き出しを重ねる）。
 * @param ctx 描画先（beginFrame 済み。CSS px 座標）
 * @param vm 描画モデル（拡大前の論理座標）
 * @param zoom 表示の拡大率（ヒーローでは街並みを表示の高さに合わせて拡大する）
 * @sideEffect ctx に描画する
 */
export function drawTownStrip(ctx: CanvasRenderingContext2D, vm: TownStripVm, zoom = 1): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.scale(zoom, zoom);
  drawWorld(ctx, vm);
  drawOverlay(ctx, vm);
  ctx.restore();
}

/**
 * 1地区だけのミニチュア（カードの絵柄）を描く。
 * @param ctx 描画先（CSS px 座標）
 * @param d 地区
 * @param size 描く大きさ（CSS px）
 * @param asIs true なら色あせ・未訪問をそのまま描く（地区のようす用）。false はカード用に色あざやかに描く
 * @sideEffect ctx に描画する
 */
export function drawDistrictMiniature(ctx: CanvasRenderingContext2D, d: StripDistrictVm, size: { readonly width: number; readonly height: number }, asIs = false): void { // audit-ignore: fnlog-missing カード1枚につき1回描く
  const scale = size.width / DISTRICT_WIDTH_PX;
  const shift = size.height / scale - ROAD_Y_PX - 6;
  ctx.save();
  ctx.scale(scale, scale);
  paintSky(ctx, [0, 0, DISTRICT_WIDTH_PX, size.height / scale]);
  paintFarSkyline(ctx, { from: 0, to: DISTRICT_WIDTH_PX }, { base: GROUND_Y_PX + shift, offset: 0, color: FAR_SKYLINE, minH: 30, maxH: 78, seed: 11, unit: 24 });
  ctx.translate(0, shift);
  drawDistrict(ctx, 0, asIs ? d : { ...d, filter: 'none', isUnvisited: false }, 0);
  fillBox(ctx, [0, ROAD_Y_PX, DISTRICT_WIDTH_PX, 20], STREET.road);
  fillBox(ctx, [0, ROAD_Y_PX, DISTRICT_WIDTH_PX, 2], '#ffffff');
  ctx.restore();
}
