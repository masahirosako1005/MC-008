/**
 * @file マイ街の小さなアイコンの絵（presentation/screens/MyTown 層。Canvas 描画の純粋関数。pixelSprites.createSprite が使う）
 * 足あと・カード・王冠・コイン・時計・星・持ち物（LED ランタン・小旗・鉢植え・カメラ）・ピンを、フラットなモダンのアイコンで描く（docs/08 §10.5）。
 * 王冠は金の線で控えめに描く。提灯・のぼり・松の絵柄は使わず、現代の道具（shared/shopIcons の paintGear）で表す。
 * 座標は 20×20 の箱（呼び出し側が拡大する）。毎回の描画から呼ばれるため関数ログは出さない（呼び出し側でまとめてログ）。
 */
import { PALETTE } from '@/Common/ui/theme/palette';
import { paintGear } from '@/presentation/shared/shopIcons';
import type { GearIcon } from '@/presentation/shared/shopIcons';

/** アイコンの名前（旧来のドット絵と同じ名前） */
export type TownIconName = 'foot' | 'card' | 'crown' | 'coin' | 'clock' | 'star' | 'chochin' | 'nobori' | 'matsu' | 'camera' | 'pin';

/** 持ち物のアイコン → 道具の絵 */
const GEAR_OF: Readonly<Partial<Record<TownIconName, GearIcon>>> = { chochin: 'lantern', nobori: 'pennant', matsu: 'plant', camera: 'camera' };

/** 線のアイコンの色（濃いスレート） */
const LINE = '#475569';

/**
 * 星（5角）のパスを作る。
 * @param ctx 描画先
 * @param c 中心 X・Y・外側の半径
 */
function starPath(ctx: CanvasRenderingContext2D, c: readonly [number, number, number]): void { // audit-ignore: fnlog-missing 毎回の描画で呼ぶ小さなパス作成
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    const r = i % 2 === 0 ? c[2] : c[2] * 0.45;
    if (i === 0) ctx.moveTo(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r);
    else ctx.lineTo(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** アイコンの描き方（20×20 の箱） */
const ICON_PAINTERS: Readonly<Record<Exclude<TownIconName, 'chochin' | 'nobori' | 'matsu' | 'camera'>, (ctx: CanvasRenderingContext2D) => void>> = {
  foot: (ctx) => {
    ctx.fillStyle = LINE;
    ctx.beginPath(); ctx.ellipse(6.5, 12, 2.6, 4.2, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(13.5, 7, 2.6, 4.2, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6.2, 17.4, 1.7, 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(13.8, 12.4, 1.7, 1.3, 0, 0, Math.PI * 2); ctx.fill();
  },
  card: (ctx) => {
    const g = ctx.createLinearGradient(3, 2, 17, 18);
    g.addColorStop(0, '#fde68a'); g.addColorStop(0.55, '#f59e0b'); g.addColorStop(1, '#b45309');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(4, 2, 12, 16, 2.5); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    starPath(ctx, [10, 9.5, 3.4]); ctx.fill();
  },
  crown: (ctx) => {
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(3, 15); ctx.lineTo(3, 6); ctx.lineTo(6.8, 10); ctx.lineTo(10, 4); ctx.lineTo(13.2, 10); ctx.lineTo(17, 6); ctx.lineTo(17, 15); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3, 12.5); ctx.lineTo(17, 12.5); ctx.stroke();
  },
  coin: (ctx) => {
    ctx.fillStyle = '#f5b700';
    ctx.beginPath(); ctx.arc(10, 10, 7.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(10, 10, 5.4, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff'; starPath(ctx, [10, 10.3, 3]); ctx.fill();
  },
  clock: (ctx) => {
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(10, 10, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(10, 5.8); ctx.moveTo(10, 10); ctx.lineTo(13.2, 11.8); ctx.stroke();
  },
  star: (ctx) => {
    ctx.fillStyle = '#f5b700';
    starPath(ctx, [10, 10.6, 8]); ctx.fill();
  },
  pin: (ctx) => {
    ctx.fillStyle = PALETTE.brand;
    ctx.beginPath(); ctx.arc(10, 8, 6, Math.PI * 0.85, Math.PI * 2.15); ctx.lineTo(10, 18.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(10, 8, 2.4, 0, Math.PI * 2); ctx.fill();
  },
};

/**
 * アイコンを 20×20 の箱に描く（呼び出し側が箱の大きさに合わせて拡大しておく）。
 * @param ctx 描画先
 * @param name アイコンの名前
 * @sideEffect ctx に描画する（状態は save/restore で戻す）
 */
export function paintTownIcon(ctx: CanvasRenderingContext2D, name: TownIconName): void { // audit-ignore: fnlog-missing 毎回の描画で呼ぶ（呼び出し側の createSprite でログ）
  ctx.save();
  const gear = GEAR_OF[name];
  if (gear !== undefined) paintGear(ctx, gear, { x: 10, y: 19 }, gear === 'camera' ? 15 : 16);
  else if (name in ICON_PAINTERS) ICON_PAINTERS[name as keyof typeof ICON_PAINTERS](ctx);
  ctx.restore();
}
