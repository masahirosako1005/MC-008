/**
 * @file 店の看板・持ち物の小さな線アイコン（presentation/shared 層。Canvas 描画の純粋関数）
 * 店先の看板にカテゴリのアイコン（カップ・パン・器など）を、アバターの持ち物・アイテム演出に道具のアイコンを描く。
 * アプリの線アイコン（docs/08 §10.2：stroke・round）と同じ調子。和の記号（提灯・のぼり・松の絵柄）は使わず現代の道具で表す。
 * 毎フレーム描画から呼ばれるため関数ログは出さない。座標は中心と半径（r）に対する割合で決める。
 */
import type { Point2D } from '@/Common/ui/canvas/geometry';

/** 店のカテゴリのアイコン */
export type ShopIcon = 'cup' | 'bread' | 'sweets' | 'bowl' | 'fish' | 'glass' | 'book' | 'bag' | 'leaf' | 'flower' | 'camera' | 'bike' | 'bath' | 'train' | 'plum';

/** 持ち物・アイテムの絵（camera=カメラ、lantern=LED ランタン、pennant=小旗、plant=鉢植え） */
export type GearIcon = 'camera' | 'lantern' | 'pennant' | 'plant';

/** アイコンを描く関数（中心・半径・色） */
type IconPainter = (ctx: CanvasRenderingContext2D, c: Point2D, r: number) => void;

/**
 * 中心からの割合で線を引く。
 * @param ctx 描画先
 * @param c 中心
 * @param r 半径
 * @param pts 頂点の割合（[x, y]、-1〜1）
 */
function stroke(ctx: CanvasRenderingContext2D, c: Point2D, r: number, pts: readonly (readonly [number, number])[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(c.x + x * r, c.y + y * r) : ctx.lineTo(c.x + x * r, c.y + y * r)));
  ctx.stroke();
}

/**
 * 中心からの割合で円（弧）を引く。
 * @param ctx 描画先
 * @param at 円の中心の割合
 * @param rr 半径の割合
 * @param c 中心・半径
 */
function ring(ctx: CanvasRenderingContext2D, at: readonly [number, number], rr: number, c: { readonly o: Point2D; readonly r: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.beginPath();
  ctx.arc(c.o.x + at[0] * c.r, c.o.y + at[1] * c.r, rr * c.r, 0, Math.PI * 2);
  ctx.stroke();
}

/** カテゴリのアイコンの描き方 */
const SHOP_ICON_PAINTERS: Readonly<Record<ShopIcon, IconPainter>> = {
  cup: (ctx, c, r) => {
    stroke(ctx, c, r, [[-0.7, -0.35], [-0.6, 0.45], [0.3, 0.45], [0.4, -0.35], [-0.7, -0.35]]);
    ctx.beginPath(); ctx.arc(c.x + 0.52 * r, c.y + 0.02 * r, 0.26 * r, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    stroke(ctx, c, r, [[-0.85, 0.75], [0.6, 0.75]]);
  },
  bread: (ctx, c, r) => {
    ctx.beginPath(); ctx.moveTo(c.x - 0.85 * r, c.y + 0.5 * r); ctx.lineTo(c.x - 0.85 * r, c.y); ctx.arc(c.x, c.y, 0.85 * r, Math.PI, 0); ctx.lineTo(c.x + 0.85 * r, c.y + 0.5 * r); ctx.closePath(); ctx.stroke();
    stroke(ctx, c, r, [[-0.35, -0.45], [-0.15, -0.05]]);
    stroke(ctx, c, r, [[0.15, -0.55], [0.35, -0.15]]);
  },
  sweets: (ctx, c, r) => {
    stroke(ctx, c, r, [[-0.65, 0], [-0.45, 0.8], [0.45, 0.8], [0.65, 0], [-0.65, 0]]);
    ctx.beginPath(); ctx.arc(c.x, c.y, 0.65 * r, Math.PI, 0); ctx.stroke();
    ring(ctx, [0, -0.78], 0.14, { o: c, r });
  },
  bowl: (ctx, c, r) => {
    ctx.beginPath(); ctx.moveTo(c.x - 0.85 * r, c.y); ctx.arc(c.x, c.y, 0.85 * r, 0, Math.PI); ctx.closePath(); ctx.stroke();
    stroke(ctx, c, r, [[-0.1, -0.15], [0.55, -0.9]]);
    stroke(ctx, c, r, [[0.15, -0.1], [0.85, -0.75]]);
  },
  fish: (ctx, c, r) => {
    ctx.beginPath(); ctx.ellipse(c.x - 0.15 * r, c.y, 0.6 * r, 0.38 * r, 0, 0, Math.PI * 2); ctx.stroke();
    stroke(ctx, c, r, [[0.45, 0], [0.9, -0.35], [0.9, 0.35], [0.45, 0]]);
    ring(ctx, [-0.45, -0.06], 0.04, { o: c, r });
  },
  glass: (ctx, c, r) => {
    stroke(ctx, c, r, [[-0.55, -0.75], [-0.45, 0.8], [0.3, 0.8], [0.4, -0.75], [-0.55, -0.75]]);
    ctx.beginPath(); ctx.arc(c.x + 0.5 * r, c.y + 0.02 * r, 0.3 * r, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    stroke(ctx, c, r, [[-0.5, -0.35], [0.35, -0.35]]);
  },
  book: (ctx, c, r) => {
    stroke(ctx, c, r, [[0, -0.55], [-0.85, -0.7], [-0.85, 0.65], [0, 0.8], [0.85, 0.65], [0.85, -0.7], [0, -0.55], [0, 0.8]]);
  },
  bag: (ctx, c, r) => {
    stroke(ctx, c, r, [[-0.7, -0.3], [-0.7, 0.8], [0.7, 0.8], [0.7, -0.3], [-0.7, -0.3]]);
    ctx.beginPath(); ctx.arc(c.x, c.y - 0.3 * r, 0.36 * r, Math.PI, 0); ctx.stroke();
  },
  leaf: (ctx, c, r) => {
    ctx.beginPath(); ctx.moveTo(c.x - 0.75 * r, c.y + 0.75 * r); ctx.quadraticCurveTo(c.x - 0.75 * r, c.y - 0.75 * r, c.x + 0.8 * r, c.y - 0.8 * r);
    ctx.quadraticCurveTo(c.x + 0.75 * r, c.y + 0.75 * r, c.x - 0.75 * r, c.y + 0.75 * r); ctx.stroke();
    stroke(ctx, c, r, [[-0.75, 0.75], [0.25, -0.25]]);
  },
  flower: (ctx, c, r) => {
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      ring(ctx, [Math.cos(a) * 0.5, Math.sin(a) * 0.5], 0.3, { o: c, r });
    }
  },
  camera: (ctx, c, r) => {
    stroke(ctx, c, r, [[-0.85, -0.45], [-0.3, -0.45], [-0.15, -0.7], [0.25, -0.7], [0.4, -0.45], [0.85, -0.45], [0.85, 0.65], [-0.85, 0.65], [-0.85, -0.45]]);
    ring(ctx, [0, 0.08], 0.32, { o: c, r });
  },
  bike: (ctx, c, r) => {
    ring(ctx, [-0.5, 0.35], 0.38, { o: c, r });
    ring(ctx, [0.5, 0.35], 0.38, { o: c, r });
    stroke(ctx, c, r, [[-0.5, 0.35], [-0.1, -0.35], [0.35, -0.35], [0.5, 0.35]]);
    stroke(ctx, c, r, [[-0.1, -0.35], [0, 0.35], [0.35, -0.35]]);
  },
  bath: (ctx, c, r) => {
    for (const y of [-0.35, 0.05, 0.45]) {
      ctx.beginPath(); ctx.moveTo(c.x - 0.8 * r, c.y + y * r);
      ctx.bezierCurveTo(c.x - 0.4 * r, c.y + (y - 0.3) * r, c.x, c.y + (y + 0.3) * r, c.x + 0.4 * r, c.y + y * r);
      ctx.quadraticCurveTo(c.x + 0.6 * r, c.y + (y - 0.15) * r, c.x + 0.8 * r, c.y + y * r); ctx.stroke();
    }
  },
  train: (ctx, c, r) => {
    stroke(ctx, c, r, [[-0.6, -0.8], [0.6, -0.8], [0.6, 0.5], [-0.6, 0.5], [-0.6, -0.8]]);
    stroke(ctx, c, r, [[-0.6, -0.15], [0.6, -0.15]]);
    stroke(ctx, c, r, [[-0.4, 0.5], [-0.6, 0.9]]);
    stroke(ctx, c, r, [[0.4, 0.5], [0.6, 0.9]]);
  },
  plum: (ctx, c, r) => {
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      ring(ctx, [Math.cos(a) * 0.48, Math.sin(a) * 0.48], 0.36, { o: c, r });
    }
    ring(ctx, [0, 0], 0.12, { o: c, r });
  },
};

/**
 * 店のカテゴリのアイコンを線で描く。
 * @param ctx 描画先
 * @param icon アイコン
 * @param c 中心
 * @param r 半径（アイコンはおよそ ±r に収まる）
 * @param color 線の色
 * @sideEffect ctx に描画する（線の設定は save/restore で戻す）
 */
export function paintShopIcon(ctx: CanvasRenderingContext2D, icon: ShopIcon, c: Point2D, r: number, color: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (r < 1.5) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.9, r * 0.2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  SHOP_ICON_PAINTERS[icon](ctx, c, r);
  ctx.restore();
}

/**
 * 持ち物・アイテムの絵（塗りの小さな道具）を描く。手で持つ位置（下端の中央）を基準にする。
 * @param ctx 描画先
 * @param gear 道具
 * @param at 持ち手（下端の中央）
 * @param size 高さの目安（CSS px）
 * @sideEffect ctx に描画する
 */
export function paintGear(ctx: CanvasRenderingContext2D, gear: GearIcon, at: Point2D, size: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(size / 20, size / 20);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  GEAR_PAINTERS[gear](ctx);
  ctx.restore();
}

/**
 * 角丸矩形を塗る（道具の絵用。20 単位の座標系）。
 * @param ctx 描画先
 * @param r x・y・幅・高さ・角丸
 * @param fill 塗り色
 */
function gearBox(ctx: CanvasRenderingContext2D, r: readonly [number, number, number, number, number], fill: string): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(r[0], r[1], r[2], r[3], r[4]);
  ctx.fill();
}

/** 道具の描き方（高さ 20 の座標系。原点は持ち手＝下端の中央） */
const GEAR_PAINTERS: Readonly<Record<GearIcon, (ctx: CanvasRenderingContext2D) => void>> = {
  camera: (ctx) => {
    gearBox(ctx, [-9, -12, 18, 12, 3], '#1f2937');
    gearBox(ctx, [-6, -14.5, 6, 3, 1], '#1f2937');
    ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.arc(0, -6, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#60a5fa'; ctx.beginPath(); ctx.arc(0, -6, 2.4, 0, Math.PI * 2); ctx.fill();
    gearBox(ctx, [4.5, -10.5, 2.5, 1.6, 0.8], '#ff5a36');
  },
  lantern: (ctx) => {
    const glow = ctx.createRadialGradient(0, -9, 0, 0, -9, 13);
    glow.addColorStop(0, 'rgba(253, 230, 138, 0.8)');
    glow.addColorStop(1, 'rgba(253, 230, 138, 0)');
    ctx.fillStyle = glow; ctx.fillRect(-13, -22, 26, 26);
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, -17, 4, Math.PI, 0); ctx.stroke();
    gearBox(ctx, [-6, -17, 12, 3, 1.5], '#374151');
    gearBox(ctx, [-5, -14, 10, 11, 3], '#fde68a');
    gearBox(ctx, [-6, -3.5, 12, 3, 1.5], '#374151');
  },
  pennant: (ctx) => {
    gearBox(ctx, [-0.9, -26, 1.8, 26, 0.9], '#475569');
    ctx.fillStyle = '#ff5a36';
    ctx.beginPath(); ctx.moveTo(0.9, -26); ctx.lineTo(15, -21); ctx.lineTo(0.9, -16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(5.5, -21, 1.6, 0, Math.PI * 2); ctx.fill();
  },
  plant: (ctx) => {
    ctx.fillStyle = '#16a34a';
    ctx.beginPath(); ctx.ellipse(-3.5, -13, 3, 6.5, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#34c77b';
    ctx.beginPath(); ctx.ellipse(3.5, -14, 3, 7, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -16, 2.6, 7.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3f4f6';
    ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(6, -8); ctx.lineTo(4.5, 0); ctx.lineTo(-4.5, 0); ctx.closePath(); ctx.fill();
    gearBox(ctx, [-6.5, -9, 13, 2.4, 1], '#d1d5db');
  },
};
