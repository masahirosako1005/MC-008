/**
 * @file 名所の控えめでモダンなピクト（presentation/shared 層。Canvas 描画の純粋関数）
 * スポット詳細・図鑑タイル（名所）とマイ街の街並み（地区の象徴）で使う、フラットな建物のピクトグラム（docs/08 §10.5）。
 * 神社も鳥居・瓦屋根ではなく「浅い屋根のパビリオン＋梅の紋（線アイコン）」で表す。商店街はガラスのアーケード、高架下は電車と高架。
 * 色は CityTone（cityArt）で受け取り、シルエット（tone.detail=false）なら細部を省いて灰色の形だけにする。
 * 毎フレーム描画から呼ばれるため関数ログは出さない（呼び出し側でまとめてログ）。
 */
import { mixColors } from '@/Common/ui/canvas/colorUtils';
import { fillBox, fillDisc, fillPoly, paintGlassShine, paintShopfront, paintStreetLamp, paintStreetTree, paintStripedAwning, paintWindowGrid } from '@/presentation/shared/cityArt';
import type { ArtBox, CityTone } from '@/presentation/shared/cityArt';
import { paintShopIcon } from '@/presentation/shared/shopIcons';

/** 名所のピクトの種類 */
export type LandmarkArt =
  | 'pavilion' | 'theater' | 'arcade' | 'viaduct' | 'museum' | 'park' | 'street' | 'blossom' | 'hall' | 'tower' | 'bathhouse' | 'station' | 'bridge';

/** ピクトを描く関数 */
export type LandmarkPainter = (ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, seed: number) => void;

/**
 * 白い丸の中に線アイコンを置いた紋（看板・屋根の飾り）を描く。
 * @param ctx 描画先
 * @param at 中心 X・Y・半径
 * @param tone 色一式
 * @param icon 線アイコン
 */
function emblem(ctx: CanvasRenderingContext2D, at: readonly [number, number, number], tone: CityTone, icon: Parameters<typeof paintShopIcon>[1]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (!tone.detail || at[2] < 3) return;
  fillDisc(ctx, at[0], at[1], at[2], '#ffffff');
  paintShopIcon(ctx, icon, { x: at[0], y: at[1] }, at[2] * 0.62, tone.accent);
}

/**
 * 神社（南森町の天満宮など）：浅い屋根のパビリオンに梅の紋。鳥居・瓦は描かない。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 */
function paintPavilion(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  const top = base - h;
  fillBox(ctx, [x, base - h * 0.08, w, h * 0.08], tone.wallShade);
  fillBox(ctx, [x + w * 0.05, base - h * 0.14, w * 0.9, h * 0.06], tone.wallAlt);
  const bodyTop = top + h * 0.42;
  const bodyH = base - h * 0.14 - bodyTop;
  fillBox(ctx, [x + w * 0.1, bodyTop, w * 0.8, bodyH], tone.wallShade);
  fillBox(ctx, [x + w * 0.36, bodyTop + bodyH * 0.18, w * 0.28, bodyH * 0.82], tone.accentSoft);
  const cw = Math.max(2, w * 0.05);
  for (const f of [0.12, 0.33, 0.67, 0.88]) {
    fillBox(ctx, [x + w * f - cw / 2, bodyTop, cw, bodyH], tone.wall);
    if (tone.detail) fillBox(ctx, [x + w * f + cw * 0.2, bodyTop, cw * 0.3, bodyH], tone.wallAlt);
  }
  fillBox(ctx, [x + w * 0.04, top + h * 0.37, w * 0.92, h * 0.06], tone.accentDeep);
  fillPoly(ctx, [[x - w * 0.05, top + h * 0.38], [x + w * 1.05, top + h * 0.38], [x + w * 0.8, top + h * 0.13], [x + w * 0.2, top + h * 0.13]], tone.accent);
  fillBox(ctx, [x + w * 0.22, top + h * 0.09, w * 0.56, h * 0.05], tone.accentDeep, 2);
  emblem(ctx, [x + w / 2, top + h * 0.255, h * 0.085], tone, 'plum');
}

/**
 * 寄席・劇場：電球の並ぶ看板と庇・ガラスの扉。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 */
function paintTheater(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  const top = base - h;
  fillBox(ctx, [x + w * 0.04, top + h * 0.08, w * 0.92, h * 0.92], tone.wall);
  fillBox(ctx, [x + w * 0.84, top + h * 0.08, w * 0.12, h * 0.92], tone.wallShade);
  fillBox(ctx, [x + w * 0.03, top + h * 0.08, w * 0.94, h * 0.03], tone.frame);
  fillBox(ctx, [x, top + h * 0.18, w, h * 0.28], tone.accent, 3);
  fillBox(ctx, [x + w * 0.16, top + h * 0.25, w * 0.68, h * 0.14], '#ffffff', 2);
  if (tone.detail) {
    for (let i = 0; i < 3; i++) fillBox(ctx, [x + w * (0.24 + i * 0.19), top + h * 0.3, w * 0.13, h * 0.04], tone.accentDeep, 1);
    for (let i = 0; i <= 12; i++) {
      const bx = x + w * 0.04 + (i * w * 0.92) / 12;
      fillDisc(ctx, bx, top + h * 0.205, Math.max(0.8, h * 0.012), tone.isLit ? tone.lit : '#ffffff');
      fillDisc(ctx, bx, top + h * 0.435, Math.max(0.8, h * 0.012), tone.isLit ? tone.lit : '#ffffff');
    }
  }
  fillBox(ctx, [x + w * 0.1, top + h * 0.56, w * 0.8, h * 0.05], tone.ink, 1);
  for (const f of [0.3, 0.51]) {
    fillBox(ctx, [x + w * f, top + h * 0.64, w * 0.19, h * 0.36], tone.glassDeep, 1);
    paintGlassShine(ctx, [x + w * f, top + h * 0.64, w * 0.19, h * 0.36], tone);
  }
  fillBox(ctx, [x + w * 0.1, top + h * 0.66, w * 0.13, h * 0.22], tone.accentSoft, 1);
  fillBox(ctx, [x + w * 0.72, top + h * 0.66, w * 0.1, h * 0.22], tone.accentSoft, 1);
}

/**
 * 商店街・市場：ガラスのアーケード屋根の下に店先が並ぶ。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 * @param seed 模様の種
 */
function paintArcade(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  const spring = base - h * 0.6;
  const bayW = (w * 0.86) / 3;
  for (let i = 0; i < 3; i++) {
    const bx = x + w * 0.07 + i * bayW + 1.5;
    fillBox(ctx, [bx, spring, bayW - 3, base - spring], i % 2 === 0 ? tone.wall : tone.wallAlt);
    paintStripedAwning(ctx, [bx + 1, spring + h * 0.14, bayW - 5, Math.max(3, h * 0.08)], tone);
    const gy = spring + h * 0.26;
    fillBox(ctx, [bx + 2, gy, bayW - 7, base - gy - 1], tone.isLit ? mixColors(tone.glass, tone.lit, 0.5) : tone.glass, 1);
    paintGlassShine(ctx, [bx + 2, gy, bayW - 7, base - gy - 1], tone);
  }
  const archH = h * 0.36;
  ctx.save();
  ctx.globalAlpha = tone.detail ? 0.7 : 1;
  ctx.fillStyle = tone.glass;
  ctx.beginPath(); ctx.ellipse(x + w / 2, spring, w / 2, archH, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = tone.frame;
  if (tone.detail) {
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const t = Math.PI + (Math.PI * i) / 8;
      ctx.beginPath(); ctx.moveTo(x + w / 2 + Math.cos(t) * w * 0.5, spring + Math.sin(t) * archH); ctx.lineTo(x + w / 2 + Math.cos(t) * w * 0.5, spring); ctx.stroke();
    }
  }
  ctx.lineWidth = Math.max(1.5, h * 0.02);
  ctx.beginPath(); ctx.ellipse(x + w / 2, spring, w / 2, archH, 0, Math.PI, 0); ctx.stroke();
  fillBox(ctx, [x + w * 0.02, spring, Math.max(2, w * 0.03), base - spring], tone.frame);
  fillBox(ctx, [x + w * 0.95, spring, Math.max(2, w * 0.03), base - spring], tone.frame);
  fillBox(ctx, [x - w * 0.01, spring - h * 0.03, w * 1.02, h * 0.11], tone.accent, 2);
  emblem(ctx, [x + w / 2, spring + h * 0.025, h * 0.075], tone, seed % 2 === 0 ? 'bag' : 'bowl');
}

/**
 * 高架下の飲食街：高架の上を電車が走り、アーチの下に灯りのともる店。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 */
function paintViaduct(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  const top = base - h;
  const deckY = top + h * 0.3;
  const deckH = h * 0.15;
  fillBox(ctx, [x + w * 0.12, top + h * 0.05, w * 0.6, h * 0.24], tone.wall, h * 0.07);
  fillBox(ctx, [x + w * 0.16, top + h * 0.09, w * 0.52, h * 0.07], tone.glass, 2);
  fillBox(ctx, [x + w * 0.12, top + h * 0.2, w * 0.6, h * 0.035], tone.accent);
  fillBox(ctx, [x, deckY, w, deckH], tone.wallAlt);
  fillBox(ctx, [x, deckY, w, Math.max(1.5, h * 0.02)], tone.frame);
  fillBox(ctx, [x, deckY + deckH * 0.62, w, deckH * 0.16], tone.accent);
  const pierTop = deckY + deckH;
  fillBox(ctx, [x, pierTop, w, base - pierTop], tone.wallShade);
  for (let i = 0; i < 3; i++) {
    const aw = w * 0.26;
    const ax = x + w * (0.05 + i * 0.32);
    const archTop = pierTop + h * 0.06;
    ctx.fillStyle = tone.isLit ? mixColors(tone.accentSoft, tone.lit, 0.6) : tone.accentSoft;
    ctx.beginPath(); ctx.roundRect(ax, archTop, aw, base - archTop, [aw / 2, aw / 2, 0, 0]); ctx.fill();
    paintStripedAwning(ctx, [ax + aw * 0.08, archTop + aw * 0.42, aw * 0.84, Math.max(3, h * 0.07)], tone);
    fillBox(ctx, [ax + aw * 0.12, base - h * 0.12, aw * 0.76, h * 0.12], tone.wall, 1);
  }
}

/**
 * 博物館：ガラスの低層の上に白い箱が張り出すモダンな建物。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 * @param seed 模様の種
 */
function paintMuseum(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  const top = base - h;
  const lowTop = top + h * 0.52;
  const low: [number, number, number, number] = [x + w * 0.08, lowTop, w * 0.84, base - lowTop];
  fillBox(ctx, low, tone.isLit ? mixColors(tone.glass, tone.lit, 0.4) : tone.glass);
  if (tone.detail) {
    ctx.fillStyle = tone.wall;
    for (let i = 1; i < 7; i++) ctx.fillRect(low[0] + (low[2] * i) / 7, low[1], 1.2, low[3]);
  }
  paintGlassShine(ctx, low, tone);
  fillBox(ctx, [x + w * 0.42, base - h * 0.26, w * 0.16, h * 0.26], tone.glassDeep);
  fillBox(ctx, [x, top + h * 0.12, w * 0.94, h * 0.4], tone.wall);
  fillBox(ctx, [x + w * 0.8, top + h * 0.12, w * 0.14, h * 0.4], tone.wallShade);
  fillBox(ctx, [x - 1, top + h * 0.12, w * 0.94 + 2, Math.max(2, h * 0.025)], tone.frame);
  paintWindowGrid(ctx, [x + w * 0.3, top + h * 0.2, w * 0.46, h * 0.26], { cols: 4, rows: 2, seed }, tone);
  fillDisc(ctx, x + w * 0.16, top + h * 0.32, h * 0.1, tone.accent);
  if (tone.detail) fillDisc(ctx, x + w * 0.16, top + h * 0.32, h * 0.045, '#ffffff');
}

/**
 * 公園：芝生の丘・大きな木・ベンチ・街灯。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 */
function paintParkScene(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  ctx.fillStyle = mixColors(tone.leaf, tone.wall, 0.55);
  ctx.beginPath(); ctx.ellipse(x + w / 2, base, w * 0.56, h * 0.24, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
  paintStreetTree(ctx, { x: x + w * 0.1, base: base - h * 0.04, w: w * 0.4, h: h * 0.96 }, tone);
  paintStreetTree(ctx, { x: x + w * 0.6, base: base - h * 0.02, w: w * 0.24, h: h * 0.62 }, tone);
  const seatY = base - h * 0.13;
  fillBox(ctx, [x + w * 0.44, seatY, w * 0.17, Math.max(1.5, h * 0.03)], tone.ink, 1);
  fillBox(ctx, [x + w * 0.44, seatY - h * 0.08, w * 0.17, Math.max(1.5, h * 0.025)], tone.ink, 1);
  fillBox(ctx, [x + w * 0.455, seatY, Math.max(1, w * 0.012), h * 0.11], tone.ink);
  fillBox(ctx, [x + w * 0.585, seatY, Math.max(1, w * 0.012), h * 0.11], tone.ink);
  paintStreetLamp(ctx, x + w * 0.88, base, h * 0.62, tone);
}

/**
 * 町並み（路地）：小さな2階建ての店が3軒並ぶ。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 * @param seed 模様の種
 */
function paintStreetRow(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const icons = ['cup', 'bag', 'book'] as const;
  const heights = [0.8, 0.96, 0.74];
  const unit = b.w / 3;
  icons.forEach((icon, i) => {
    paintShopfront(ctx, { x: b.x + i * unit + 1, base: b.base, w: unit - 2, h: b.h * (heights[i] ?? 0.8) }, tone, { icon, floors: 2, seed: seed + i });
  });
}

/**
 * 桜の名所：桜の並木と散策路。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 */
function paintBlossomWalk(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  fillBox(ctx, [x - w * 0.04, base - h * 0.05, w * 1.08, h * 0.05], tone.wallAlt, 2);
  const trees: readonly (readonly [number, number, number])[] = [[0.0, 0.34, 0.78], [0.22, 0.4, 1], [0.5, 0.36, 0.88], [0.7, 0.3, 0.7]];
  for (const [fx, fw, fh] of trees) paintStreetTree(ctx, { x: x + w * fx, base: base - h * 0.03, w: w * fw, h: h * fh }, tone, true);
  fillBox(ctx, [x + w * 0.92, base - h * 0.42, Math.max(1.5, w * 0.012), h * 0.4], tone.ink);
  fillBox(ctx, [x + w * 0.86, base - h * 0.52, w * 0.13, h * 0.14], tone.accent, 2);
  if (tone.detail) paintShopIcon(ctx, 'flower', { x: x + w * 0.925, y: base - h * 0.45 }, h * 0.045, '#ffffff');
}

/**
 * 歴史ある建築・資料館：破風と列柱のピクト（館の汎用形）。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 */
function paintClassicHall(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  const top = base - h;
  fillBox(ctx, [x, base - h * 0.07, w, h * 0.07], tone.wallShade);
  fillBox(ctx, [x + w * 0.04, base - h * 0.13, w * 0.92, h * 0.06], tone.wallAlt);
  const colTop = top + h * 0.38;
  fillBox(ctx, [x + w * 0.08, colTop, w * 0.84, base - h * 0.13 - colTop], tone.wallShade);
  const cw = Math.max(2, w * 0.07);
  for (let i = 0; i < 5; i++) {
    const cx = x + w * (0.12 + i * 0.19);
    fillBox(ctx, [cx - cw / 2, colTop, cw, base - h * 0.13 - colTop], tone.wall);
    if (tone.detail) fillBox(ctx, [cx + cw * 0.2, colTop, cw * 0.3, base - h * 0.13 - colTop], tone.wallAlt);
  }
  fillBox(ctx, [x + w * 0.03, top + h * 0.3, w * 0.94, h * 0.08], tone.accentDeep);
  fillPoly(ctx, [[x, top + h * 0.31], [x + w, top + h * 0.31], [x + w / 2, top + h * 0.04]], tone.accent);
  if (tone.detail) fillDisc(ctx, x + w / 2, top + h * 0.21, h * 0.045, '#ffffff');
}

/**
 * 展望塔：細い塔に展望室のガラスの輪。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 */
function paintObservationTower(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  const top = base - h;
  const cx = x + w / 2;
  fillPoly(ctx, [[cx - w * 0.16, base], [cx + w * 0.16, base], [cx + w * 0.05, top + h * 0.3], [cx - w * 0.05, top + h * 0.3]], tone.wallAlt);
  fillPoly(ctx, [[cx + w * 0.04, base], [cx + w * 0.16, base], [cx + w * 0.05, top + h * 0.3], [cx + w * 0.02, top + h * 0.3]], tone.wallShade);
  fillBox(ctx, [cx - w * 0.2, top + h * 0.2, w * 0.4, h * 0.12], tone.isLit ? mixColors(tone.glass, tone.lit, 0.5) : tone.glass, h * 0.04);
  fillBox(ctx, [cx - w * 0.22, top + h * 0.31, w * 0.44, h * 0.03], tone.accent, 1);
  fillBox(ctx, [cx - 0.8, top, 1.6, h * 0.2], tone.frame);
  fillBox(ctx, [x + w * 0.18, base - h * 0.1, w * 0.64, h * 0.1], tone.wall);
}

/**
 * 銭湯・温泉：煙突と波のアイコンの看板の店。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 * @param seed 模様の種
 */
function paintBathhouse(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone, seed: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  const top = base - h;
  fillBox(ctx, [x + w * 0.76, top + h * 0.14, w * 0.09, h * 0.86], tone.wallAlt);
  fillBox(ctx, [x + w * 0.76, top + h * 0.2, w * 0.09, h * 0.05], tone.accent);
  if (tone.detail) {
    ctx.save();
    ctx.globalAlpha = 0.6; ctx.strokeStyle = tone.frame; ctx.lineWidth = Math.max(1, h * 0.015); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + w * 0.805, top + h * 0.12); ctx.bezierCurveTo(x + w * 0.77, top + h * 0.08, x + w * 0.85, top + h * 0.05, x + w * 0.81, top); ctx.stroke();
    ctx.restore();
  }
  paintShopfront(ctx, { x, base, w: w * 0.86, h: h * 0.62 }, tone, { icon: 'bath', floors: 1, seed });
}

/**
 * 駅：水平の庇・ガラスのコンコース・丸い駅の看板。
 * @param ctx 描画先
 * @param b 範囲
 * @param tone 色一式
 */
function paintStation(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  const top = base - h;
  fillBox(ctx, [x, top + h * 0.3, w, h * 0.7], tone.wall);
  fillBox(ctx, [x + w * 0.9, top + h * 0.3, w * 0.1, h * 0.7], tone.wallShade);
  fillBox(ctx, [x, top + h * 0.3, w, h * 0.1], tone.accent);
  const glass: [number, number, number, number] = [x + w * 0.06, top + h * 0.5, w * 0.8, h * 0.5 - 1];
  fillBox(ctx, glass, tone.isLit ? mixColors(tone.glass, tone.lit, 0.5) : tone.glass);
  if (tone.detail) {
    ctx.fillStyle = tone.wall;
    for (let i = 1; i < 6; i++) ctx.fillRect(glass[0] + (glass[2] * i) / 6, glass[1], 1, glass[3]);
  }
  paintGlassShine(ctx, glass, tone);
  fillBox(ctx, [x - w * 0.05, top + h * 0.44, w * 1.1, h * 0.06], tone.ink, 1);
  fillBox(ctx, [x + w * 0.5 - 0.8, top + h * 0.2, 1.6, h * 0.1], tone.frame);
  fillDisc(ctx, x + w * 0.5, top + h * 0.14, h * 0.13, tone.accent);
  if (tone.detail) paintShopIcon(ctx, 'train', { x: x + w * 0.5, y: top + h * 0.14 }, h * 0.08, '#ffffff');
}

/**
 * 川に架かる橋：細い鋼のアーチと吊り材・水平の橋桁。
 * @param ctx 描画先
 * @param b 範囲（base は水面側）
 * @param tone 色一式
 */
function paintArchBridge(ctx: CanvasRenderingContext2D, b: ArtBox, tone: CityTone): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, base, w, h } = b;
  const top = base - h;
  const deckY = base - h * 0.32;
  const ctrlY = top - (deckY - top) * 0.9;
  fillBox(ctx, [x + w * 0.1, deckY, w * 0.05, base - deckY], tone.wallShade);
  fillBox(ctx, [x + w * 0.85, deckY, w * 0.05, base - deckY], tone.wallShade);
  if (tone.detail) {
    ctx.fillStyle = tone.frame;
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      const ay = (1 - t) * (1 - t) * deckY + 2 * t * (1 - t) * ctrlY + t * t * deckY;
      ctx.fillRect(x + w * (0.08 + t * 0.84), ay, 1, deckY - ay);
    }
  }
  ctx.strokeStyle = tone.accent;
  ctx.lineWidth = Math.max(2, h * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + w * 0.08, deckY); ctx.quadraticCurveTo(x + w / 2, ctrlY, x + w * 0.92, deckY); ctx.stroke();
  fillBox(ctx, [x, deckY, w, h * 0.14], tone.wall);
  fillBox(ctx, [x, deckY + h * 0.1, w, h * 0.04], tone.accentDeep);
}

/** ピクトの種類 → 描く関数 */
export const LANDMARK_PAINTERS: Readonly<Record<LandmarkArt, LandmarkPainter>> = {
  pavilion: paintPavilion,
  theater: paintTheater,
  arcade: paintArcade,
  viaduct: paintViaduct,
  museum: paintMuseum,
  park: paintParkScene,
  street: paintStreetRow,
  blossom: paintBlossomWalk,
  hall: paintClassicHall,
  tower: paintObservationTower,
  bathhouse: paintBathhouse,
  station: paintStation,
  bridge: paintArchBridge,
};
