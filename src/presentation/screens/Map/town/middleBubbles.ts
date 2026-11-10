/**
 * @file 中間の表示の吹き出し（presentation/screens/Map/town 層。毎フレーム描く）
 * 2026-11-10 ユーザー指示「中間は、アイコン消して、吹き出しだけにしてほしい」。
 * 中間（地区全体）では、お店の写真ピン・名所のドット絵・トイレのアイコンを描かず、温かみのある紙の吹き出しだけを置く。
 * - お店＝看板商品の短い吹き出し（9字まで）。未発見は「？」だけ（何のお店かは近づくと分かる＝B）。名所＝地区の色の紙の札で名前
 * - トイレはトイレのフィルタに合うとき・行きたいのときだけ小さな吹き出し
 * - しっぽの先の小さな点が正確な位置。重なりを避けて、大事なもの（選択中＞今日だけ＞行きたい＞フィルタに合う＞クーポン・イベント＞名所＞達成済み＞その他）から置き、置けないものは点だけ
 * 吹き出しと点のどちらをタップしても選べる（PlacedSpot.hit）。座標はログに出さない。
 */
import { easeOutBack } from '@/Common/ui/canvas/easing';
export { easeOutBack } from '@/Common/ui/canvas/easing';
import { CANVAS_FONT_FAMILY } from '@/Common/ui/canvas/drawUtils';
import { PALETTE } from '@/Common/ui/theme/palette';
import { project } from '@/presentation/screens/Map/MapViewModel';
import type { PlacedSpot, SceneInput, SceneSpot } from '@/presentation/screens/Map/town/townScene';

/** 中間の吹き出しの文字数の上限（これより長ければ … で切る） */
export const MIDDLE_BUBBLE_MAX_CHARS = 9;
/** 同時に出す吹き出しの数の上限（強い順。選択中のスポットは数えない）。残りは点で出し、タップで吹き出しになる（地図を文字で埋めない。2026-11-10 UI/UX 改善・仮） */
export const MIDDLE_BUBBLE_MAX_COUNT = 6;
/** 吹き出しのしっぽの長さ（CSS px） */
export const BUBBLE_TAIL_PX = 7;
/** 吹き出しどうしのすき間（CSS px） */
const GAP_PX = 3;
/** 位置の点の半径（CSS px） */
const DOT_R = 3.5;
/** 吹き出しが出てくる動き（ミリ秒） */
const POP_MS = 260;
/** 画面の外でも置いて考える余白（CSS px） */
const PAD_PX = 60;

/** 吹き出しの絵の色（紙・縁・文字。ブランドの落ち着いたオレンジとベージュの地に合わせる） */
const COLORS = {
  paper: '#fffaf2',
  paperVisited: PALETTE.brandSoft,
  paperUnknown: PALETTE.paperDeep,
  paperHot: PALETTE.metalGoldLight,
  paperWant: '#ffe9ee',
  edge: PALETTE.brand,
  edgeSoft: PALETTE.brandLight,
  edgeHot: PALETTE.metalGold,
  edgeWant: '#e8829b',
  edgeUnknown: PALETTE.sepia,
  toilet: '#3e6fb5',
  ink: PALETTE.ink,
  mutedInk: PALETTE.mutedInk,
  shadow: 'rgba(42, 33, 27, 0.18)',
  white: PALETTE.white,
} as const;

/** 中間に置いた吹き出し */
export interface MiddleCallout {
  readonly kind: 'shop' | 'unknown' | 'landmark' | 'toilet';
  readonly text: string;
  /** 吹き出しの左上と大きさ（CSS px） */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** しっぽの付け根の x */
  readonly tailX: number;
  /** 吹き出しが点より下にある（しっぽが上向き） */
  readonly below: boolean;
  /** 吹き出しの上の小さな札（今日だけ・クーポン） */
  readonly tag?: string;
  readonly hot: boolean;
  readonly selected: boolean;
  /** 札の色（名所は地区の色） */
  readonly accent: string;
  /** 文字の大きさ（CSS px、拡大率込み） */
  readonly fontPx: number;
}

/** 矩形 */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 前回の置き方（パンしても吹き出しが跳ねないよう、同じ置き方から試す） */
const lastTrial = new Map<string, number>();
/** 吹き出しが出始めた時刻（ポンと出す動き用） */
const shownAt = new Map<string, number>();

/** できたてを売るお店のカテゴリ（短い声に「できたて」を付ける） */
const FRESH = new Set(['パン', 'たこ焼き', 'お好み焼き', '精肉コロッケ', '餃子', '串カツ', '焼き鳥', 'おにぎり', '豆腐']);

/**
 * 吹き出しの文字の太字のフォント指定（アプリ共通の書体）。
 * @param sizePx 文字の大きさ（拡大率前）
 * @param scale 文字の拡大率
 * @returns CSS のフォント指定
 */
export function roundFont(sizePx: number, scale = 1): string { // audit-ignore: fnlog-missing 毎フレーム描画
  return `800 ${Math.round(sizePx * scale * 10) / 10}px ${CANVAS_FONT_FAMILY}`;
}

/**
 * 文字列を上限の文字数で切る（長ければ末尾を … にする）。
 * @param text 文字列
 * @param max 上限
 * @returns 切った文字列
 */
export function clipText(text: string, max: number): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な文字列ヘルパー
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}

/**
 * 中間の吹き出しの文字（未発見の店は「？」、名所・トイレは名前、お店は看板商品）。
 * @param spot スポット
 * @param selected 選択中か（名前を出す）
 * @returns 文字
 */
export function middleTextOf(spot: SceneSpot, selected: boolean): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な文字列ヘルパー
  if (spot.kind === 'shop' && spot.status === 'unknown') return '？';
  if (spot.kind !== 'shop' || selected) return clipText(spot.name ?? '？', MIDDLE_BUBBLE_MAX_CHARS + 1);
  const label = spot.goods?.label ?? spot.name ?? '？';
  if (spot.today?.hot === true) return clipText(`${label}！`, MIDDLE_BUBBLE_MAX_CHARS);
  const fresh = `できたて${label}`;
  if (FRESH.has(spot.category ?? '') && [...fresh].length <= MIDDLE_BUBBLE_MAX_CHARS && spot.seed % 2 === 0) return fresh;
  return clipText(label, MIDDLE_BUBBLE_MAX_CHARS);
}

/**
 * 置く順の強さ（大きいほど先に良い場所を取る）。
 * @param spot スポット
 * @param match フィルタに合うか（無効なら undefined）
 * @param selectedId 選択中のスポット
 * @returns 強さ
 */
export function middlePriority(spot: SceneSpot, match: boolean | undefined, selectedId: string | undefined): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な採点
  if (spot.id === selectedId) return 1000;
  let score = 0;
  if (spot.today?.hot === true) score += 500;
  if (spot.want) score += 300;
  if (match === true) score += 200;
  if (spot.today !== undefined) score += 100;
  if (spot.kind === 'landmark') score += 80;
  if (spot.status === 'visited') score += 50;
  else if (spot.status === 'discovered') score += 20;
  if (match === false) score -= 900;
  return score;
}

/**
 * 文字の幅を見積もる（canvas が無くても配置を決められるよう、全角 1em・半角 0.58em で数える）。
 * @param text 文字
 * @param fontPx 文字の大きさ
 * @returns 幅（CSS px）
 */
export function estimateTextWidth(text: string, fontPx: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) < 0x2e80 ? 0.58 : 1;
  return w * fontPx;
}

/**
 * 2つの矩形が（すき間込みで）重なるか。
 * @param a 矩形
 * @param b 矩形
 * @returns 重なれば true
 */
function overlaps(a: Box, b: Box): boolean { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な判定ヘルパー
  return a.x < b.x + b.w + GAP_PX && a.x + a.w + GAP_PX > b.x && a.y < b.y + b.h + GAP_PX && a.y + a.h + GAP_PX > b.y;
}

/**
 * 吹き出しを置ける場所を探す（上・左上・右上・下の順。前回と同じ置き方を先に試す）。
 * @param id スポットID
 * @param at 点の画面座標
 * @param w 吹き出しの幅
 * @param h 吹き出しの高さ
 * @param taken 置いた吹き出し
 * @param vpWidth 描画領域の幅
 * @returns 置いた場所（置けなければ undefined）
 */
function findSlot(id: string, at: { x: number; y: number }, w: number, h: number, taken: readonly Box[], vpWidth: number): { box: Box; tailX: number; below: boolean } | undefined { // audit-ignore: fnlog-missing 毎フレーム描画
  const aboveY = at.y - BUBBLE_TAIL_PX - h - 1;
  const belowY = at.y + BUBBLE_TAIL_PX + 1;
  const trials: { x: number; y: number; below: boolean }[] = [
    { x: at.x - w / 2, y: aboveY, below: false },
    { x: at.x - w + 14, y: aboveY, below: false },
    { x: at.x - 14, y: aboveY, below: false },
    { x: at.x - w / 2, y: belowY, below: true },
  ];
  const first = lastTrial.get(id) ?? 0;
  const order = [first, ...[0, 1, 2, 3].filter((k) => k !== first)];
  for (const k of order) {
    const trial = trials[k];
    if (trial === undefined) continue;
    const x = Math.min(Math.max(4, trial.x), vpWidth - w - 4);
    if (at.x < x + 10 || at.x > x + w - 10) continue;
    const box = { x: Math.round(x), y: Math.round(trial.y), w, h };
    if (taken.some((r) => overlaps(r, box))) continue;
    lastTrial.set(id, k);
    return { box, tailX: at.x, below: trial.below };
  }
  return undefined;
}

/** 中間に置く候補（画面座標・フィルタの判定・置く順の強さ） */
interface MiddleItem {
  readonly spot: SceneSpot;
  readonly x: number;
  readonly y: number;
  readonly match: boolean | undefined;
  readonly priority: number;
}

/**
 * 中間に置く候補を集めて、置く順（強い順・上から）に並べる。トイレはトイレのフィルタに合うとき・行きたい・選択中だけ。
 * @param spots スポット
 * @param input 描画の入力
 * @returns 候補
 */
function middleItemsOf(spots: readonly SceneSpot[], input: SceneInput): MiddleItem[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const items: MiddleItem[] = [];
  for (const spot of spots) {
    const match = input.matches?.(spot);
    if (spot.kind === 'toilet' && match !== true && !spot.want && spot.id !== input.selectedId) continue;
    const p = project(input.camera, input.vp, spot.ll);
    if (p.x < -PAD_PX || p.y < -PAD_PX || p.x > input.vp.width + PAD_PX || p.y > input.vp.height + PAD_PX) continue;
    items.push({ spot, x: p.x, y: p.y, match, priority: middlePriority(spot, match, input.selectedId) });
  }
  return items.sort((a, b) => b.priority - a.priority || a.y - b.y);
}

/**
 * 候補1つ分の吹き出しの中身と大きさを決める。
 * @param it 候補
 * @param input 描画の入力
 * @returns 種類・文字・文字の大きさ・幅・高さ・札
 */
function calloutContentOf(it: MiddleItem, input: SceneInput): { kind: MiddleCallout['kind']; text: string; fontPx: number; w: number; h: number; tag?: string } { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = it.spot;
  const ts = input.textScale;
  const selected = s.id === input.selectedId;
  const kind: MiddleCallout['kind'] = s.kind === 'toilet' ? 'toilet' : s.kind === 'landmark' ? 'landmark' : s.status === 'unknown' ? 'unknown' : 'shop';
  const text = middleTextOf(s, selected);
  const fontPx = (selected ? 12.5 : kind === 'unknown' ? 12 : 11) * ts;
  const h = Math.round((selected ? 26 : 21) * ts);
  const w = Math.round(Math.max(kind === 'unknown' ? h + 2 : 30, estimateTextWidth(text, fontPx) + (kind === 'landmark' ? 24 : 16)));
  const tag = s.kind === 'shop' && s.status !== 'unknown' && s.today !== undefined ? s.today.tag : undefined;
  return { kind, text, fontPx, w, h, ...(tag === undefined ? {} : { tag }) };
}

/**
 * 中間の表示で、見えているスポットを吹き出しで置く（置けないものは点だけ）。
 * @param spots スポット
 * @param input 描画の入力
 * @returns 置いたスポット（点だけのもの → 吹き出しの順＝描く順）
 */
export function layoutMiddleBubbles(spots: readonly SceneSpot[], input: SceneInput): PlacedSpot[] { // audit-ignore: fnlog-missing 毎フレーム描画
  // 地区の布の旗などの場所は先に埋めておき、吹き出しが重ならないようにする
  const taken: Box[] = (input.reserved ?? []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  const dots: PlacedSpot[] = [];
  const bubbles: PlacedSpot[] = [];
  const seen = new Set<string>();
  for (const it of middleItemsOf(spots, input)) {
    const s = it.spot;
    const content = calloutContentOf(it, input);
    const full = s.id !== input.selectedId && bubbles.filter((b) => b.callout?.selected !== true).length >= MIDDLE_BUBBLE_MAX_COUNT;
    const slot = full ? undefined : findSlot(s.id, it, content.w, content.h, taken, input.vp.width);
    if (slot === undefined) {
      dots.push({ spot: s, x: it.x, y: it.y, scale: 1, match: it.match, bubble: false, label: false, pin: 0, hit: { x: it.x - 10, y: it.y - 10, w: 20, h: 20 } });
      continue;
    }
    taken.push(slot.box);
    seen.add(s.id);
    if (!shownAt.has(s.id)) shownAt.set(s.id, input.t);
    const callout: MiddleCallout = {
      kind: content.kind,
      text: content.text,
      ...slot.box,
      tailX: slot.tailX,
      below: slot.below,
      ...(content.tag === undefined ? {} : { tag: content.tag }),
      hot: s.today?.hot === true,
      selected: s.id === input.selectedId,
      accent: content.kind === 'landmark' ? (s.districtColor ?? COLORS.edge) : content.kind === 'toilet' ? COLORS.toilet : COLORS.edge,
      fontPx: content.fontPx,
    };
    // 当たり判定は吹き出し・札・点をまとめて囲む
    const top = Math.min(slot.box.y - (content.tag === undefined ? 0 : 12), it.y - 10);
    const bottom = Math.max(slot.box.y + slot.box.h, it.y + 10);
    const left = Math.min(slot.box.x, it.x - 10);
    const right = Math.max(slot.box.x + slot.box.w, it.x + 10);
    bubbles.push({ spot: s, x: it.x, y: it.y, scale: 1, match: it.match, bubble: true, label: false, pin: 0, callout, hit: { x: left, y: top, w: right - left, h: bottom - top } });
  }
  for (const id of shownAt.keys()) if (!seen.has(id)) shownAt.delete(id);
  bubbles.sort((a, b) => Number(a.callout?.selected === true) - Number(b.callout?.selected === true) || a.y - b.y);
  return [...dots, ...bubbles];
}

/**
 * 吹き出しの形（角丸の箱としっぽを1本の線でつなぐ）のパスを作る。
 * @param ctx 2D コンテキスト
 * @param box 箱
 * @param radius 角の半径
 * @param tailX しっぽの先の x
 * @param tailLen しっぽの長さ
 * @param below 箱が点より下にある（しっぽが上向き）
 * @param tipX しっぽの先の x（省略時は tailX）
 * @sideEffect ctx の現在パスを置き換える
 */
export function bubblePath(ctx: CanvasRenderingContext2D, box: Box, radius: number, tailX: number, tailLen: number, below: boolean, tipX = tailX): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, y, w, h } = box;
  const r = Math.min(radius, h / 2, w / 2);
  const half = Math.min(6, w / 2 - r - 1);
  const tx = Math.min(Math.max(tailX, x + r + half), x + w - r - half);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  if (below) {
    ctx.lineTo(tx - half, y);
    ctx.quadraticCurveTo(tx - half * 0.2, y - tailLen * 0.35, tipX, y - tailLen);
    ctx.quadraticCurveTo(tx + half * 0.4, y - tailLen * 0.25, tx + half, y);
  }
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  if (!below) {
    ctx.lineTo(tx + half, y + h);
    ctx.quadraticCurveTo(tx + half * 0.2, y + h + tailLen * 0.35, tipX, y + h + tailLen);
    ctx.quadraticCurveTo(tx - half * 0.4, y + h + tailLen * 0.25, tx - half, y + h);
  }
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * 中間の吹き出しと点を描く。
 * @param ctx 2D コンテキスト
 * @param placed 置いたスポット（layoutMiddleBubbles の結果）
 * @param input 描画の入力
 * @sideEffect canvas に描く
 */
export function drawMiddleBubbles(ctx: CanvasRenderingContext2D, placed: readonly PlacedSpot[], input: SceneInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  // 浮いている部品（上の絞り込みの列・お店の列・下の左右の部品）と地区の旗の下に入る点は描かない（部品の端から半分だけのぞいて見えるため。選択中は描く）
  const reserved = input.reserved ?? [];
  const r = DOT_R + 3;
  for (const p of placed) {
    if (p.callout !== undefined) continue;
    if (p.spot.id !== input.selectedId && reserved.some((b) => p.x + r > b.x && p.x - r < b.x + b.w && p.y + r > b.y && p.y - r < b.y + b.h)) continue;
    drawSpotDot(ctx, p, input);
  }
  for (const p of placed) if (p.callout !== undefined) drawCallout(ctx, p, p.callout, input);
}

/**
 * 位置の点（達成済みはオレンジ、未発見は灰色、名所は地区の色。白いふち）。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @sideEffect canvas に描く
 */
function drawSpotDot(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const color = s.kind === 'landmark' ? (s.districtColor ?? COLORS.edge) : s.kind === 'toilet' ? COLORS.toilet : s.status === 'visited' ? COLORS.edge : s.status === 'unknown' ? COLORS.edgeUnknown : PALETTE.subInk;
  ctx.save();
  ctx.globalAlpha = p.match === false ? 0.3 : 1;
  if (s.id === input.selectedId) {
    const k = 0.5 + 0.5 * Math.sin(input.t / 240);
    ctx.strokeStyle = COLORS.edge;
    ctx.globalAlpha *= 0.35 + 0.35 * k;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, DOT_R + 5 + k * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = p.match === false ? 0.3 : 1;
  }
  ctx.fillStyle = COLORS.shadow;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 1.5, DOT_R + 1.5, (DOT_R + 1.5) * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.white;
  ctx.beginPath();
  ctx.arc(p.x, p.y, DOT_R + 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, DOT_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 吹き出しを1つ描く（ポンと出て、今日だけはゆっくり弾む。選択中はオレンジ地に白い文字）。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param c 吹き出し
 * @param input 描画の入力
 * @sideEffect canvas に描く
 */
function drawCallout(ctx: CanvasRenderingContext2D, p: PlacedSpot, c: MiddleCallout, input: SceneInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const age = input.t - (shownAt.get(s.id) ?? input.t - POP_MS);
  const pop = age >= POP_MS ? 1 : 0.55 + 0.45 * easeOutBack(age / POP_MS);
  const bob = c.hot || c.selected ? Math.sin(input.t / (c.selected ? 200 : 380) + s.seed) * 1.6 : 0;
  ctx.save();
  ctx.globalAlpha = (p.match === false ? 0.3 : 1) * (s.status === 'visited' ? 1 - Math.min(0.35, s.fade * 0.4) : 1);
  drawSpotDot(ctx, p, input);
  // ポンと出る動きは、しっぽの先（点）を支点に拡大する
  ctx.translate(p.x, p.y);
  ctx.scale(pop, pop);
  ctx.translate(-p.x, -p.y + bob);
  const box = { x: c.x, y: c.y, w: c.w, h: c.h };
  const tipY = c.below ? c.y - BUBBLE_TAIL_PX : c.y + c.h + BUBBLE_TAIL_PX;
  if (c.kind === 'landmark') drawLandmarkTag(ctx, c, box, tipY);
  else drawShopCallout(ctx, c, box, s);
  if (c.tag !== undefined) drawCalloutTag(ctx, c, input.textScale);
  ctx.restore();
}

/**
 * お店（・未発見・トイレ）の吹き出しの本体。
 * @param ctx 2D コンテキスト
 * @param c 吹き出し
 * @param box 箱
 * @param s スポット
 * @sideEffect canvas に描く
 */
function drawShopCallout(ctx: CanvasRenderingContext2D, c: MiddleCallout, box: Box, s: SceneSpot): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const unknown = c.kind === 'unknown';
  const toilet = c.kind === 'toilet';
  const fill = c.selected ? COLORS.edge : c.hot ? COLORS.paperHot : s.want ? COLORS.paperWant : unknown ? COLORS.paperUnknown : s.status === 'visited' ? COLORS.paperVisited : COLORS.paper;
  const edge = c.selected ? PALETTE.brandDeep : c.hot ? COLORS.edgeHot : s.want ? COLORS.edgeWant : unknown ? COLORS.edgeUnknown : toilet ? COLORS.toilet : s.status === 'visited' ? COLORS.edge : COLORS.edgeSoft;
  const radius = box.h / 2;
  // 影
  ctx.save();
  ctx.translate(0, 2);
  bubblePath(ctx, box, radius, c.tailX, BUBBLE_TAIL_PX, c.below);
  ctx.fillStyle = COLORS.shadow;
  ctx.fill();
  ctx.restore();
  bubblePath(ctx, box, radius, c.tailX, BUBBLE_TAIL_PX, c.below);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = c.selected ? 2.2 : 1.8;
  ctx.strokeStyle = edge;
  if (unknown) ctx.setLineDash([3, 2.5]);
  ctx.stroke();
  ctx.setLineDash([]);
  // 紙のつや（上辺の細い光）
  if (!c.selected && !unknown) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x + radius, box.y + 2.2);
    ctx.lineTo(box.x + box.w - radius, box.y + 2.2);
    ctx.stroke();
  }
  ctx.font = roundFont(c.fontPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = c.selected ? COLORS.white : unknown ? COLORS.mutedInk : toilet ? COLORS.toilet : COLORS.ink;
  ctx.fillText(c.text, box.x + box.w / 2, box.y + box.h / 2 + 0.5, box.w - 10);
}

/**
 * 名所の札（地区の色の帯と穴のある紙の札。少しだけ傾ける）。
 * @param ctx 2D コンテキスト
 * @param c 吹き出し
 * @param box 箱
 * @param tipY しっぽの先の y
 * @sideEffect canvas に描く
 */
function drawLandmarkTag(ctx: CanvasRenderingContext2D, c: MiddleCallout, box: Box, tipY: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const tilt = c.selected ? 0 : (((Math.abs(Math.round(c.tailX * 7 + tipY)) % 5) - 2) * Math.PI) / 260;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.save();
  // 札からお店の点へ下がる糸
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(c.tailX, c.below ? box.y : box.y + box.h);
  ctx.lineTo(c.tailX, tipY + (c.below ? -1 : 1) * 2);
  ctx.stroke();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = COLORS.shadow;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y + 2, box.w, box.h, 4);
  ctx.fill();
  ctx.fillStyle = c.selected ? c.accent : COLORS.paper;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 4);
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = c.accent;
  ctx.stroke();
  // 左の帯と、ひもを通す穴
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, 12, box.h, [4, 0, 0, 4]);
  ctx.fill();
  ctx.fillStyle = COLORS.paper;
  ctx.beginPath();
  ctx.arc(box.x + 6, box.y + box.h / 2, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = roundFont(c.fontPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = c.selected ? COLORS.white : COLORS.ink;
  ctx.fillText(c.text, box.x + 12 + (box.w - 12) / 2, box.y + box.h / 2 + 0.5, box.w - 18);
  ctx.restore();
}

/**
 * 吹き出しの左上に重ねる小さな札（今日だけは金、それ以外はオレンジ）。
 * @param ctx 2D コンテキスト
 * @param c 吹き出し
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawCalloutTag(ctx: CanvasRenderingContext2D, c: MiddleCallout, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const text = c.tag ?? '';
  const fontPx = 8.5 * Math.min(textScale, 1.15);
  const w = Math.round(estimateTextWidth(text, fontPx) + 10);
  const h = Math.round(13 * Math.min(textScale, 1.15));
  const x = c.x + 6;
  const y = c.y - h + 4;
  ctx.fillStyle = c.hot ? COLORS.edgeHot : COLORS.edge;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.white;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.font = roundFont(fontPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = c.hot ? PALETTE.metalGoldInk : COLORS.white;
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
}
