/**
 * @file お店の「声」（地図の中から吹き出しで呼びかける。presentation/screens/Map/town 層）
 * 2026-11-09 ユーザー指示「マップの中から声（暖かい緑茶があります！クリスマスフェア中など）表現が見えるといいね」。
 * 画面に映っているお店から、順番に最大3つまで吹き出しを出す（今日だけ・開催中のイベントを優先）。
 * 文言は今日の情報（今日だけ・クーポン・イベント）→ 季節と看板商品（冬はあったかいもの、12月はクリスマス）→ 呼び込みの順に選ぶ。
 * 未発見の店は名前も商品も伏せて「いいにおいがする…」のような気配だけ（B: 未開拓への興味）。乱数は使わず日付と店の ID で決める。
 */
import { createLogger } from '@/Common/logging/logger';
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import { hashString } from '@/Common/ui/canvas/seededHash';
import type { PlacedSpot, SceneSpot } from '@/presentation/screens/Map/town/townScene';

const logger = createLogger('presentation/screens/Map/town/shopVoices');

/** 同時に出す吹き出しの数 */
export const MAX_VOICES = 3;
/** 次の吹き出しを出すまでの間（ミリ秒） */
export const VOICE_EVERY_MS = 2200;
/** 1つの吹き出しを出しておく時間（ミリ秒） */
export const VOICE_MS = 3800;
/** 吹き出しの最大幅（CSS px） */
const MAX_WIDTH = 168;
/** インク */
const INK = '#1f2430';

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
    if ((month >= 11 || month <= 2) && WARM.has(category)) lines.push(`あったかい${label}あります！`);
    if (FRESH.has(category)) lines.push(`${label}、できたてです！`);
    lines.push(`${label}がおすすめ！`);
  }
  if (spot.status === 'visited') lines.push('また来てくれたんですね！');
  lines.push('いらっしゃいませ〜！');
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
}

/** お店の声（順番に吹き出しを出して描く） */
export class ShopVoices {
  private voices: Voice[] = [];
  private nextAt = 0;
  private turn = 0;

  /**
   * 吹き出しを入れ替える（古いものを消し、間が空いたら次のお店の声を足す）。
   * @param placed 画面に置いたスポット
   * @param now 現在時刻
   * @param today 今日（YYYY-MM-DD）
   * @sideEffect 吹き出しの一覧を書き換える
   */
  update(placed: readonly PlacedSpot[], now: number, today: string): void { // audit-ignore: fnlog-missing 毎フレーム呼ぶ（足すときだけ pick がログ）
    this.voices = this.voices.filter((v) => now - v.startedAt < VOICE_MS && placed.some((p) => p.spot.id === v.spotId && p.pin > 0));
    if (now < this.nextAt || this.voices.length >= MAX_VOICES) return;
    this.nextAt = now + VOICE_EVERY_MS;
    this.pick(placed, now, today);
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
    this.voices.push({ spotId: chosen.spot.id, text, hot: chosen.spot.today?.hot === true, startedAt: now });
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
   * 吹き出しを描く（お店の写真ピンの上。重なるときは上へずらす）。
   * @param ctx 2D コンテキスト
   * @param placed 画面に置いたスポット
   * @param now 現在時刻
   * @param textScale 文字の拡大率
   * @sideEffect canvas に描く
   */
  draw(ctx: CanvasRenderingContext2D, placed: readonly PlacedSpot[], now: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    for (const v of this.voices) {
      const p = placed.find((q) => q.spot.id === v.spotId);
      if (p === undefined || p.pin <= 0) continue;
      const top = p.y - p.pin - 12 - (p.spot.today !== undefined ? 18 : 4);
      drawVoice(ctx, p.x, top, v, now, textScale, taken);
    }
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
 * 吹き出しを1つ描く（はねて出て、少し浮かびながら消える）。
 * @param ctx 2D コンテキスト
 * @param x しっぽの先の x
 * @param bottom しっぽの先の y
 * @param v 吹き出し
 * @param now 現在時刻
 * @param textScale 文字の拡大率
 * @param taken ほかの吹き出しの矩形（重ならないよう上へずらす）
 * @sideEffect canvas に描く。taken に追加する
 */
function drawVoice(ctx: CanvasRenderingContext2D, x: number, bottom: number, v: Voice, now: number, textScale: number, taken: { x: number; y: number; w: number; h: number }[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const age = now - v.startedAt;
  if (age < 0 || age > VOICE_MS) return;
  const pop = age < 240 ? 0.6 + 0.4 * easeOutBack(age / 240) : 1;
  const alpha = age > VOICE_MS - 450 ? (VOICE_MS - age) / 450 : Math.min(1, age / 120);
  ctx.save();
  ctx.font = canvasFont(11, 800, textScale);
  let text = v.text;
  while (ctx.measureText(text).width > MAX_WIDTH - 16 && text.length > 2) text = `${text.slice(0, -2)}…`;
  const w = ctx.measureText(text).width + 16;
  const h = 22 * textScale;
  const left = Math.round(x - w / 2);
  let top = Math.round(bottom - h - 6 - (age / VOICE_MS) * 4);
  for (let tries = 0; tries < 3 && taken.some((r) => left < r.x + r.w && left + w > r.x && top < r.y + r.h && top + h > r.y); tries++) top -= h + 4;
  taken.push({ x: left, y: top, w, h });
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.translate(x, top + h);
  ctx.scale(pop, pop);
  ctx.translate(-x, -(top + h));
  ctx.fillStyle = 'rgba(17, 24, 39, 0.14)';
  ctx.beginPath();
  ctx.roundRect(left, top + 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = v.hot ? '#fff3c4' : '#ffffff';
  ctx.strokeStyle = v.hot ? '#ffc83d' : 'rgba(31, 36, 48, 0.14)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 5, top + h - 1);
  ctx.lineTo(x + 5, top + h - 1);
  ctx.lineTo(x, top + h + 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + w / 2, top + h / 2 + 0.5);
  ctx.restore();
}

/**
 * はねる形（少し行き過ぎて戻る）。
 * @param k 進み 0..1
 * @returns なめらかにした進み
 */
function easeOutBack(k: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  const c = Math.min(1, Math.max(0, k));
  const s = 1.70158;
  return 1 + (s + 1) * (c - 1) ** 3 + s * (c - 1) ** 2;
}
