/**
 * @file お店の「声」（地図の中から吹き出しで呼びかける。presentation/screens/Map/town 層）
 * 2026-11-09 ユーザー指示「マップの中から声（暖かい緑茶があります！クリスマスフェア中など）表現が見えるといいね」。
 * 画面に映っているお店から、順番に最大3つまで吹き出しを出す（今日だけ・開催中のイベントを優先）。
 * 文言は今日の情報（今日だけ・クーポン・イベント）→ 季節と看板商品（冬はあったかいもの、12月はクリスマス）→ 呼び込みの順に選ぶ。
 * 未発見の店は名前も商品も伏せて「いいにおいがする…」のような気配だけ（B: 未開拓への興味）。乱数は使わず日付と店の ID で決める。
 * 2026-11-10 ユーザー指示「お店からメッセージは温かみのある表示で、人を誘うような吹き出しで、目立つように」:
 * クリーム色の紙の吹き出し＋オレンジの太い縁、左にお店の人の笑顔（はちまき・三角巾・コック帽）、太字の文字。
 * ポンと出て、ゆっくり上下し、ときどき「おいで」と揺れる。今日だけは金色に光ってきらめく。吹き出しをタップするとそのお店を選ぶ。
 * 詳細（写真ピンがあるとき）だけ出す。中間は town/middleBubbles の吹き出しが代わりを務める（ピンが無いので候補にならない）。
 */
import { createLogger } from '@/Common/logging/logger';
import { hashString } from '@/Common/ui/canvas/seededHash';
import { PALETTE } from '@/Common/ui/theme/palette';
import { bubblePath, easeOutBack, roundFont } from '@/presentation/screens/Map/town/middleBubbles';
import { registerOverlayHits } from '@/presentation/screens/Map/town/townScene';
import type { OverlayHit, PlacedSpot, SceneSpot } from '@/presentation/screens/Map/town/townScene';

const logger = createLogger('presentation/screens/Map/town/shopVoices');

/** 同時に出す吹き出しの数 */
export const MAX_VOICES = 3;
/** 次の吹き出しを出すまでの間（ミリ秒） */
export const VOICE_EVERY_MS = 2000;
/** 1つの吹き出しを出しておく時間（ミリ秒） */
export const VOICE_MS = 4600;
/** 吹き出しの最大幅（CSS px） */
const MAX_WIDTH = 214;
/** ポンと出る時間（ミリ秒） */
const POP_MS = 380;
/** 「おいで」と揺れる間隔と長さ（ミリ秒） */
const BECKON_EVERY_MS = 1500;
const BECKON_MS = 460;
/** しっぽの長さ（CSS px） */
const TAIL_PX = 9;
/** お店の人の顔の直径（CSS px、拡大率前） */
const FACE_PX = 30;
/** 吹き出しの角の半径の上限（2行のとき丸くなりすぎない） */
const MAX_RADIUS_PX = 20;

/** 吹き出しとお店の人の絵の色（紙・縁・肌・髪など） */
const VOICE_COLORS = {
  paper: '#fffaf0',
  paperHot: '#fff3c9',
  edge: PALETTE.brand,
  edgeHot: PALETTE.metalGold,
  ink: PALETTE.ink,
  shadow: 'rgba(42, 33, 27, 0.2)',
  glow: 'rgba(226, 171, 46, 0.55)',
  faceBg: PALETTE.brandSoft,
  skin: '#f6d4b8',
  hair: '#3b2a20',
  cheek: 'rgba(236, 120, 120, 0.45)',
  mouth: '#c8463c',
  white: PALETTE.white,
} as const;

/** 温かいものを出すお店のカテゴリ（冬は「あったかい」を付ける） */
const WARM = new Set(['喫茶', 'カフェ', '日本茶', 'うどん', 'そば', '甘味処', '食堂', '惣菜', 'たこ焼き', 'お好み焼き', '銭湯', '酒店', '立ち飲み']);
/** できたてを売るお店のカテゴリ */
const FRESH = new Set(['パン', 'たこ焼き', 'お好み焼き', '精肉コロッケ', '和菓子', '洋菓子', '餃子', '串カツ', '焼き鳥', 'おにぎり', '惣菜', '豆腐', 'うどん', 'そば']);
/** クリスマスに合うお店のカテゴリ */
const XMAS = new Set(['洋菓子', 'パン', 'カフェ', '喫茶', '雑貨', '花', 'ジェラート', '酒店']);

/**
 * お店の声の候補を返す（強い順）。
 * @param spot 描くスポット
 * @param today 今日（YYYY-MM-DD）
 * @returns 候補（無ければ空）
 */
export function voiceLinesOf(spot: SceneSpot, today: string): string[] {
  const log = logger.fn('voiceLinesOf', { spotId: spot.id });
  if (spot.kind !== 'shop') return log.exit([]);
  if (spot.status === 'unknown') return log.exit(['いいにおいがする…', 'なにかのお店…？', 'ちょっと寄ってみて…']);
  const lines: string[] = [];
  if (spot.today !== undefined) lines.push(spot.today.hot ? exclaim(spot.today.title) : `${spot.today.tag}！${spot.today.title}`);
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const label = spot.goods?.label;
  const category = spot.category ?? '';
  if ((month === 12 || (month === 11 && day >= 20)) && XMAS.has(category)) lines.push('クリスマスフェア中！');
  if (label !== undefined) {
    if ((month >= 11 || month <= 2) && WARM.has(category)) lines.push(`あったかい${label}、どうぞ〜！`);
    if (FRESH.has(category)) lines.push(`${label}、できたてです！`);
    lines.push(`${label}、食べていって！`);
  }
  if (spot.status === 'visited') lines.push('おかえりなさい！寄ってって〜');
  lines.push('ちょっと寄っていきませんか？');
  return log.exit(lines);
}

/**
 * 文の終わりに「！」を付ける（すでに記号で終わっていれば付けない）。
 * @param text 文
 * @returns 付けた文
 */
function exclaim(text: string): string { // audit-ignore: fnlog-missing 文言を作るときに呼ぶ純粋な文字列ヘルパー
  return /[！!。…？?]$/.test(text) ? text : `${text}！`;
}

/** 出している吹き出し */
interface Voice {
  readonly spotId: string;
  readonly text: string;
  readonly hot: boolean;
  readonly startedAt: number;
  /** お店の人の見た目のばらつき */
  readonly seed: number;
  /** はちまき・三角巾・エプロンの色（お店のひさしの色） */
  readonly awning: string;
}

/** 吹き出しの矩形 */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** お店の声（順番に吹き出しを出して描く） */
export class ShopVoices {
  private voices: Voice[] = [];
  private nextAt = 0;
  private turn = 0;

  /**
   * 吹き出しを入れ替える（古いものを消し、間が空いたら次のお店の声を足す）。写真ピンが無いお店（中間の表示）は候補にしない。
   * @param placed 画面に置いたスポット
   * @param now 現在時刻
   * @param today 今日（YYYY-MM-DD）
   * @param hidden 浮いている部品の下になるので描いていないスポット（声も出さない）
   * @sideEffect 吹き出しの一覧を書き換える
   */
  update(placed: readonly PlacedSpot[], now: number, today: string, hidden?: ReadonlySet<string>): void { // audit-ignore: fnlog-missing 毎フレーム呼ぶ（足すときだけ pick がログ）
    this.voices = this.voices.filter((v) => now - v.startedAt < VOICE_MS && hidden?.has(v.spotId) !== true && placed.some((p) => p.spot.id === v.spotId && p.pin > 0));
    if (now < this.nextAt || this.voices.length >= MAX_VOICES) return;
    this.nextAt = now + VOICE_EVERY_MS;
    this.pick(hidden === undefined ? placed : placed.filter((p) => !hidden.has(p.spot.id)), now, today);
  }

  /**
   * 次に声を出すお店を選んで足す（今日だけ・イベント → 行きたい → ほかの順に、交代で）。
   * @param placed 画面に置いたスポット
   * @param now 現在時刻
   * @param today 今日
   * @sideEffect 吹き出しを1つ足す
   */
  private pick(placed: readonly PlacedSpot[], now: number, today: string): void {
    const log = logger.fn('pick', { placed: placed.length, showing: this.voices.length });
    const candidates = placed
      .filter((p) => p.pin > 0 && p.match !== false && p.spot.kind === 'shop' && !this.voices.some((v) => v.spotId === p.spot.id))
      .sort((a, b) => rank(b.spot) - rank(a.spot));
    if (candidates.length === 0) return log.exit(undefined, '候補なし');
    const strong = candidates.filter((p) => rank(p.spot) >= 2);
    const pool = strong.length > 0 && this.turn % 2 === 0 ? strong : candidates;
    const chosen = pool[this.turn % pool.length];
    this.turn += 1;
    if (chosen === undefined) return log.exit(undefined);
    const lines = voiceLinesOf(chosen.spot, today);
    const text = lines[hashString(`${chosen.spot.id}|${today}|${this.turn}`) % Math.min(lines.length, chosen.spot.today !== undefined ? 1 : lines.length)] ?? lines[0];
    if (text === undefined) return log.exit(undefined, '文言なし');
    this.voices.push({ spotId: chosen.spot.id, text, hot: chosen.spot.today?.hot === true, startedAt: now, seed: chosen.spot.seed, awning: chosen.spot.awning });
    log.exit(undefined, chosen.spot.id);
  }

  /**
   * 吹き出しが出ているか。
   * @returns 出ていれば true
   */
  active(): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
    return this.voices.length > 0;
  }

  /**
   * 吹き出しを描く（お店の写真ピンの上。重なるときは上へずらす）。タップで選べるよう当たり判定も覚える。
   * @param ctx 2D コンテキスト
   * @param placed 画面に置いたスポット
   * @param now 現在時刻
   * @param textScale 文字の拡大率
   * @param avoid 吹き出しを重ねない矩形（上の絞り込みの列・下の左右の部品・お店カード。重なる吹き出しは描かない）
   * @returns 描いた吹き出しの矩形（「あなた」の札と重なるかの判定に使う）
   * @sideEffect canvas に描く。placed に吹き出しの当たり判定を結びつける（hitTestScene が使う）
   */
  draw(ctx: CanvasRenderingContext2D, placed: readonly PlacedSpot[], now: number, textScale: number, avoid: readonly Rect[] = []): readonly Rect[] { // audit-ignore: fnlog-missing 毎フレーム描画
    const taken: Rect[] = [];
    const hits: OverlayHit[] = [];
    for (const v of this.voices) {
      const p = placed.find((q) => q.spot.id === v.spotId);
      if (p === undefined || p.pin <= 0) continue;
      // 画面の外のお店の声は出さない（吹き出しだけが画面の中へ寄って、ほかのピンを隠すため）
      if (p.x < 0 || p.x > ctx.canvas.clientWidth) continue;
      const tip = p.y - p.pin - 12 - (p.spot.today !== undefined ? 18 : 4);
      const rect = drawVoice(ctx, p.x, tip, v, now, textScale, taken, avoid);
      if (rect !== undefined) hits.push({ spotId: v.spotId, ...rect });
    }
    registerOverlayHits(placed, hits);
    return taken;
  }
}

/**
 * 声を出す順番の強さ（今日だけ 3・開催中 2・行きたい 1・ほか 0）。
 * @param spot スポット
 * @returns 強さ
 */
function rank(spot: SceneSpot): number { // audit-ignore: fnlog-missing 並べ替えで呼ぶ純粋な判定ヘルパー
  if (spot.today?.hot === true) return 3;
  if (spot.today !== undefined) return 2;
  return spot.want ? 1 : 0;
}

/**
 * 吹き出しを1つ描く（ポンと出て、ゆっくり上下し、ときどき「おいで」と揺れて、少し浮かびながら消える）。
 * @param ctx 2D コンテキスト
 * @param x しっぽの先の x
 * @param tipY しっぽの先の y
 * @param v 吹き出し
 * @param now 現在時刻
 * @param textScale 文字の拡大率
 * @param taken ほかの吹き出しの矩形（重ならないよう上へずらす）
 * @param avoid 重ねない矩形（浮いている部品。重なるなら描かない）
 * @returns 描いた吹き出しの矩形（当たり判定用。描かなければ undefined）
 * @sideEffect canvas に描く。taken に追加する
 */
function drawVoice(ctx: CanvasRenderingContext2D, x: number, tipY: number, v: Voice, now: number, textScale: number, taken: Rect[], avoid: readonly Rect[]): Rect | undefined { // audit-ignore: fnlog-missing 毎フレーム描画
  const age = now - v.startedAt;
  if (age < 0 || age > VOICE_MS) return undefined;
  const ts = Math.min(textScale, 1.3);
  const pop = age < POP_MS ? 0.3 + 0.7 * easeOutBack(age / POP_MS) : 1;
  const alpha = age > VOICE_MS - 500 ? (VOICE_MS - age) / 500 : Math.min(1, age / 140);
  const face = FACE_PX * ts;
  ctx.save();
  ctx.font = roundFont(13.5, ts);
  const lines = wrapVoiceText(ctx, v.text, MAX_WIDTH - face - 26);
  const lineH = 17 * ts;
  const w = Math.round(Math.max(...lines.map((l) => ctx.measureText(l).width)) + face + 26);
  const h = Math.round(Math.max(face + 10, (lines.length > 1 ? 22 + lineH * 2 : 38) * ts));
  const width = ctx.canvas.clientWidth;
  const left = Math.round(width > w + 8 ? Math.min(Math.max(4, x - w / 2), width - w - 4) : x - w / 2);
  let top = Math.round(tipY - h - TAIL_PX - (age / VOICE_MS) * 4);
  for (let tries = 0; tries < 3 && taken.some((r) => left < r.x + r.w && left + w > r.x && top < r.y + r.h && top + h > r.y); tries++) top -= h + 6;
  const rect = { x: left, y: top, w, h };
  if (avoid.some((r) => left < r.x + r.w && left + w > r.x && top < r.y + r.h && top + h + TAIL_PX > r.y)) {
    ctx.restore();
    return undefined;
  }
  taken.push(rect);
  const tip = { x, y: top + h + TAIL_PX };
  // ゆっくり上下＋ときどき「おいで」と揺れる（しっぽの先を支点に回す）
  const bob = Math.sin(age / 520 + v.seed) * 2;
  const beckonAt = (age + (v.seed % 7) * 90) % BECKON_EVERY_MS;
  const beckon = age > POP_MS && beckonAt < BECKON_MS ? Math.sin((beckonAt / BECKON_MS) * Math.PI * 3) * 0.075 * (1 - beckonAt / BECKON_MS) : 0;
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.translate(tip.x, tip.y);
  ctx.rotate(beckon);
  ctx.scale(pop, pop);
  ctx.translate(-tip.x, -tip.y + bob);
  if (v.hot) drawHotGlow(ctx, rect, now);
  paintVoicePaper(ctx, rect, x, v.hot);
  drawShopkeeper(ctx, left + 6 + face / 2, top + h / 2, face, v, age);
  ctx.fillStyle = VOICE_COLORS.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((line, k) => ctx.fillText(line, left + face + 13, top + h / 2 + 1 + (k - (lines.length - 1) / 2) * lineH));
  if (v.hot) drawSparkles(ctx, rect, now);
  ctx.restore();
  return rect;
}

/**
 * 声を吹き出しの幅に収める（1行に入らなければ、句読点の後ろか真ん中で2行に分け、それでも長ければ … で切る）。
 * @param ctx 2D コンテキスト（フォント設定済み）
 * @param text 声
 * @param maxW 1行の最大幅（CSS px）
 * @returns 1行または2行
 */
function wrapVoiceText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] { // audit-ignore: fnlog-missing 毎フレーム描画
  if (ctx.measureText(text).width <= maxW) return [text];
  const chars = [...text];
  const lo = Math.ceil(chars.length * 0.3);
  const hi = Math.floor(chars.length * 0.7);
  let cut = Math.round(chars.length / 2);
  for (let k = hi; k >= lo; k--) {
    if (/[！!、。…？?〜 ]/.test(chars[k - 1] ?? '')) {
      cut = k;
      break;
    }
  }
  /**
   * 1行を幅に収める（長ければ末尾を … にする）。
   * @param line 1行
   * @returns 収めた1行
   */
  const fit = (line: string): string => { // audit-ignore: fnlog-missing 毎フレーム描画
    let out = line;
    while (ctx.measureText(out).width > maxW && out.length > 2) out = `${out.slice(0, -2)}…`;
    return out;
  };
  return [fit(chars.slice(0, cut).join('')), fit(chars.slice(cut).join(''))];
}

/**
 * 吹き出しの紙（影 → クリーム色の紙 → オレンジの太い縁 → 上辺のつや）。今日だけは金の縁。
 * @param ctx 2D コンテキスト
 * @param rect 吹き出しの箱
 * @param tailX しっぽの先の x
 * @param hot 今日だけか
 * @sideEffect canvas に描く
 */
function paintVoicePaper(ctx: CanvasRenderingContext2D, rect: Rect, tailX: number, hot: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = Math.min(rect.h / 2, MAX_RADIUS_PX);
  ctx.save();
  ctx.translate(0, 3);
  bubblePath(ctx, rect, r, tailX, TAIL_PX, false);
  ctx.fillStyle = VOICE_COLORS.shadow;
  ctx.fill();
  ctx.restore();
  bubblePath(ctx, rect, r, tailX, TAIL_PX, false);
  ctx.fillStyle = hot ? VOICE_COLORS.paperHot : VOICE_COLORS.paper;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = hot ? VOICE_COLORS.edgeHot : VOICE_COLORS.edge;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y + 3.5);
  ctx.lineTo(rect.x + rect.w - r, rect.y + 3.5);
  ctx.stroke();
}

/**
 * 今日だけの吹き出しのまわりの金色の光（ゆっくり脈打つ）。
 * @param ctx 2D コンテキスト
 * @param box 吹き出しの箱
 * @param now 現在時刻
 * @sideEffect canvas に描く
 */
function drawHotGlow(ctx: CanvasRenderingContext2D, box: Rect, now: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const k = 0.5 + 0.5 * Math.sin(now / 300);
  ctx.save();
  ctx.shadowColor = VOICE_COLORS.glow;
  ctx.shadowBlur = 10 + k * 12;
  ctx.fillStyle = VOICE_COLORS.paperHot;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(box.h / 2, MAX_RADIUS_PX));
  ctx.fill();
  ctx.restore();
}

/**
 * 今日だけの吹き出しの角でまたたく星（4つの光の筋）。
 * @param ctx 2D コンテキスト
 * @param box 吹き出しの箱
 * @param now 現在時刻
 * @sideEffect canvas に描く
 */
function drawSparkles(ctx: CanvasRenderingContext2D, box: Rect, now: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const points: readonly (readonly [number, number, number])[] = [
    [box.x + box.w - 6, box.y - 2, 0],
    [box.x + 4, box.y + box.h - 2, 1.7],
    [box.x + box.w * 0.55, box.y - 5, 3.1],
  ];
  ctx.save();
  for (const [sx, sy, phase] of points) {
    const k = Math.max(0, Math.sin(now / 260 + phase));
    if (k <= 0.05) continue;
    const r = 2 + k * 4;
    ctx.globalAlpha = k;
    ctx.fillStyle = VOICE_COLORS.white;
    ctx.strokeStyle = VOICE_COLORS.edgeHot;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.quadraticCurveTo(sx, sy, sx + r, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy + r);
    ctx.quadraticCurveTo(sx, sy, sx - r, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy - r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * お店の人の笑顔（丸い窓の中に、髪・はちまき／三角巾／コック帽・にっこり目・話す口・ほっぺ・エプロン）。
 * @param ctx 2D コンテキスト
 * @param cx 中心の x
 * @param cy 中心の y
 * @param size 直径
 * @param v 吹き出し（見た目のばらつき・ひさしの色）
 * @param age 出てからの時間（ミリ秒。口を動かす）
 * @sideEffect canvas に描く
 */
function drawShopkeeper(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, v: Voice, age: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = size / 2;
  const u = size / 26;
  const talk = Math.abs(Math.sin(age / 130)) * (age < 1600 ? 1 : 0.35);
  ctx.save();
  ctx.fillStyle = VOICE_COLORS.faceBg;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.clip();
  // 髪・顔・エプロン
  ctx.fillStyle = VOICE_COLORS.hair;
  ctx.beginPath();
  ctx.arc(cx, cy + 1 * u, 9.5 * u, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = VOICE_COLORS.skin;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 3 * u, 8.6 * u, 8.2 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = v.awning;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 16 * u, 11 * u, 5 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  drawHeadwear(ctx, cx, cy, u, v);
  drawFaceParts(ctx, cx, cy, u, talk);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = VOICE_COLORS.edge;
  ctx.globalAlpha *= 0.5;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 顔の部品（にっこり目・ほっぺ・話している口）。
 * @param ctx 2D コンテキスト
 * @param cx 顔の中心の x
 * @param cy 顔の中心の y
 * @param u 1単位の大きさ（顔の直径 26 を基準）
 * @param talk 口の開き 0..1
 * @sideEffect canvas に描く
 */
function drawFaceParts(ctx: CanvasRenderingContext2D, cx: number, cy: number, u: number, talk: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.strokeStyle = VOICE_COLORS.ink;
  ctx.lineWidth = 1.5 * u;
  ctx.lineCap = 'round';
  for (const dx of [-3.4, 3.4]) {
    ctx.beginPath();
    ctx.arc(cx + dx * u, cy + 2.6 * u, 1.9 * u, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
  // ほっぺ
  ctx.fillStyle = VOICE_COLORS.cheek;
  for (const dx of [-5.6, 5.6]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * u, cy + 5.4 * u, 1.9 * u, 1.2 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 話している口（開け閉め）
  ctx.fillStyle = VOICE_COLORS.mouth;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 6.6 * u, 2.4 * u, (1.1 + talk * 1.4) * u, 0, 0, Math.PI);
  ctx.fill();
}

/**
 * お店の人の頭の飾り（店ごとに はちまき／三角巾／コック帽）。
 * @param ctx 2D コンテキスト
 * @param cx 顔の中心の x
 * @param cy 顔の中心の y
 * @param u 1単位の大きさ（顔の直径 26 を基準）
 * @param v 吹き出し（見た目のばらつき・ひさしの色）
 * @sideEffect canvas に描く
 */
function drawHeadwear(ctx: CanvasRenderingContext2D, cx: number, cy: number, u: number, v: Voice): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const style = v.seed % 3;
  if (style === 0) {
    // はちまき（結び目つき）
    ctx.fillStyle = VOICE_COLORS.white;
    ctx.fillRect(cx - 9.5 * u, cy - 3.6 * u, 19 * u, 3.2 * u);
    ctx.fillStyle = v.awning;
    ctx.fillRect(cx - 9.5 * u, cy - 3.6 * u, 19 * u, 1.2 * u);
    ctx.fillStyle = VOICE_COLORS.white;
    ctx.beginPath();
    ctx.ellipse(cx + 8.5 * u, cy - 4.6 * u, 2.2 * u, 1.4 * u, -0.6, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (style === 1) {
    // 三角巾（水玉）
    ctx.fillStyle = v.awning;
    ctx.beginPath();
    ctx.moveTo(cx - 10 * u, cy - 1.5 * u);
    ctx.quadraticCurveTo(cx, cy - 13 * u, cx + 10 * u, cy - 1.5 * u);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(cx - 3 * u, cy - 6 * u, 1 * u, 0, Math.PI * 2);
    ctx.arc(cx + 3 * u, cy - 7 * u, 1 * u, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // コック帽
  ctx.fillStyle = VOICE_COLORS.white;
  ctx.beginPath();
  ctx.arc(cx - 4 * u, cy - 9 * u, 4 * u, 0, Math.PI * 2);
  ctx.arc(cx + 4 * u, cy - 9 * u, 4 * u, 0, Math.PI * 2);
  ctx.arc(cx, cy - 11 * u, 4.5 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - 7 * u, cy - 8 * u, 14 * u, 4.5 * u);
  ctx.strokeStyle = PALETTE.paperDeep;
  ctx.lineWidth = 0.8 * u;
  ctx.beginPath();
  ctx.moveTo(cx - 7 * u, cy - 3.6 * u);
  ctx.lineTo(cx + 7 * u, cy - 3.6 * u);
  ctx.stroke();
}
