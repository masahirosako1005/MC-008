/**
 * @file 地図に描く「人」（自分のアイコンとほかの旅人）の配置と描画（presentation/screens/Map 層）
 * - 自分: 現在地にマイ街と同じアバター（ドット絵）を立たせる。歩くと弾み、進む向きを向く。アバターが無いときは朱の人型バッジ
 * - ほかの旅人: 自分と同じドット絵のアバター（服の色・帽子・持ち物は人ごとに固定。地区の主は王冠）。詳細では名前を添える。画像が作れないときは白い丸に頭文字
 * ほかの旅人の位置は地区単位のデータ（OtherTravelerDto）から、地区内のスポットのそばに決定論的に置く（実際の細かい位置は扱わない＝CLAUDE.md 10）。
 * 配置（placeTravelers・hitTestPerson）は純粋関数。描画は毎フレーム呼ぶので logger.fn を置かない。
 */
import { createLogger } from '@/Common/logging/logger';
import { toRgba } from '@/Common/ui/canvas/colorUtils';
import { canvasFont, drawRoundRect } from '@/Common/ui/canvas/drawUtils';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { hashString } from '@/Common/ui/canvas/seededHash';
import { PALETTE } from '@/Common/ui/theme/palette';
import type { OtherTravelerDto } from '@/application/dto/Dto';
import { project } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, MapViewModel, Viewport } from '@/presentation/screens/Map/MapViewModel';
import type { MapZoom } from '@/presentation/screens/Map/ZoomState';
import { avatarSpriteFor } from '@/presentation/shared/avatarSprite';
import type { AvatarLook, AvatarSprite } from '@/presentation/shared/avatarSprite';
import { personColorOfId, personLookOf } from '@/presentation/shared/personLook';

const logger = createLogger('presentation/screens/Map/mapPeople');

/**
 * 王冠（地区の主）を描く。
 * @param ctx 2D コンテキスト
 * @param at 王冠の中心
 * @param size 幅（CSS px）
 * @sideEffect ctx に描画する
 */
function drawCrown(ctx: CanvasRenderingContext2D, at: Point2D, size: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const w = size;
  const hgt = size * 0.72;
  const x = at.x - w / 2;
  const y = at.y - hgt / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(42, 33, 27, 0.2)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + hgt * 0.28);
  ctx.lineTo(x + w * 0.26, y + hgt * 0.55);
  ctx.lineTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 0.74, y + hgt * 0.55);
  ctx.lineTo(x + w, y + hgt * 0.28);
  ctx.lineTo(x + w * 0.88, y + hgt);
  ctx.lineTo(x + w * 0.12, y + hgt);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, y, 0, y + hgt);
  g.addColorStop(0, '#ffe38a');
  g.addColorStop(1, PALETTE.goldDeep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = PALETTE.white;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/** ほかの旅人の色（人ごとに固定。ランキングと共通なので shared/personLook に置く） */
export { PERSON_COLORS } from '@/presentation/shared/personLook';
/** ほかの旅人のバッジ半径（CSS px）。広域は小さく、地区・詳細は読める大きさにする */
const OTHER_RADIUS: Readonly<Record<MapZoom, number>> = { wide: 8, district: 14, near: 15 };
/** 自分のバッジ半径（CSS px） */
const SELF_RADIUS: Readonly<Record<MapZoom, number>> = { wide: 12, district: 15, near: 16 };
/** 基準点からずらす距離（CSS px。地区・詳細はスポットのピンと重ならないように） */
const ANCHOR_OFFSET_PX: Readonly<Record<MapZoom, number>> = { wide: 14, district: 30, near: 32 };
/** ほかの旅人どうし・自分との最小間隔（バッジ半径の何倍か） */
const MIN_GAP_RATIO = 2.1;
/** 置き場所を探す方向の数（45°刻み） */
const DIRECTIONS = 8;
/** ほかの旅人のタップ判定の余白（CSS px） */
const PERSON_HIT_SLOP_PX = 6;
/** 1歩にかける時間（ミリ秒）。歩きの揺れの速さ（仮） */
export const WALK_STEP_MS = 270;
/** 歩いているときに体が弾む高さ（CSS px） */
const WALK_BOB_PX = 3.5;
/** 歩いているときの左右の傾き（ラジアン） */
const WALK_TILT_RAD = 0.12;
/** 歩いているときに足が上がる高さ（CSS px） */
const WALK_FOOT_LIFT_PX = 3;
/** 自分のアバターの拡大率（1 で高さ約 70px。マイ街のヒーローは 0.9） */
export const SELF_AVATAR_SCALE: Readonly<Record<MapZoom, number>> = { wide: 0.46, district: 0.62, near: 0.7 };
/** 地図のアバターの1ドットの大きさ（CSS px。マイ街は 3px。小さく描くので細かくして同じくらいのドット数にする） */
export const AVATAR_DOT_PX = 2;
/** ほかの旅人が避ける、自分の体の中心（足元からの高さ、CSS px） */
const SELF_BODY_OFFSET_PX = 24;
/** ほかの旅人のアバターの拡大率（自分より少し小さくして、自分を見つけやすくする） */
export const OTHER_AVATAR_SCALE: Readonly<Record<MapZoom, number>> = { wide: 0.38, district: 0.5, near: 0.56 };
/** ほかの旅人のタップ判定に使う体の中心（足元からの高さ、CSS px） */
const OTHER_BODY_LIFT_PX = 16;

/** 画面上に置いたほかの旅人 */
export interface PlacedPerson {
  readonly traveler: OtherTravelerDto;
  /** バッジの中心（canvas 内 CSS px） */
  readonly at: Point2D;
  readonly radius: number;
  readonly color: string;
}

/** 人を描く入力 */
export interface PeopleDrawInput {
  readonly people: readonly PlacedPerson[];
  /** 自分の位置（canvas 内 CSS px。不明なら undefined） */
  readonly self?: Point2D;
  readonly zoom: MapZoom;
  /** 文字拡大の倍率 */
  readonly textScale: number;
  /** 歩きの位相（ラジアン。walkPhaseOf の値）。立ち止まっているときは undefined */
  readonly walkPhase?: number;
  /** 自分のアバターのドット絵（マイ街と同じ見た目）。無ければ人型のバッジで描く */
  readonly avatar?: AvatarSprite;
  /** 左向きに歩いている（アバターを左右反転する） */
  readonly facingLeft?: boolean;
  /** 端末のピクセル比（ほかの旅人のアバター画像を作るのに使う。無ければほかの旅人は丸いバッジで描く） */
  readonly dpr?: number;
  /** 「あなた」の札を出さない（お店の声の吹き出しが札の所に重なるとき。吹き出しの文字を隠さない） */
  readonly hideSelfTag?: boolean;
}

/**
 * 人ごとの色を返す（ライバルID から決めるので、複数の地区に出ても同じ色）。
 * @param key OtherTravelerDto.key（ライバルID:地区ID）
 * @returns '#rrggbb'
 */
export function personColorOf(key: string): string { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋なヘルパー
  return personColorOfId(key.split(':')[0] ?? key);
}

/** placeTravelers の表示条件（カメラ・描画領域・ズーム・自分の画面位置） */
export interface PeopleView {
  readonly camera: Camera;
  readonly viewport: Viewport;
  readonly zoom: MapZoom;
  readonly self?: Point2D;
}

/**
 * ほかの旅人を画面上に置く。広域は地区の中央のまわり（上端の地区名と重ねない）、地区・詳細は地区内のスポットを1つ決め（キーから決定論的に）、ピンの斜め横にずらす。
 * ほかの人・自分と重なるときは 45° ずつ回して空いている向きを探す（見つからなければ最初の向き）。
 * @param travelers ほかの旅人（地区単位）
 * @param vm 描画データ
 * @param view カメラ・描画領域・ズーム・自分の画面位置
 * @returns 置いたほかの旅人（地区が見つからない人は除く）
 */
export function placeTravelers(travelers: readonly OtherTravelerDto[], vm: MapViewModel, view: PeopleView): PlacedPerson[] { // audit-ignore: fnlog-missing 毎フレーム描画
  const radius = OTHER_RADIUS[view.zoom];
  const offset = ANCHOR_OFFSET_PX[view.zoom];
  // 自分は足元と体（アバターは足元から上に立つ）の両方を避ける
  const taken: Point2D[] = view.self === undefined ? [] : [view.self, { x: view.self.x, y: view.self.y - SELF_BODY_OFFSET_PX }];
  const placed: PlacedPerson[] = [];
  for (const traveler of travelers) {
    const anchor = anchorOf(traveler, vm, view.zoom);
    if (anchor === undefined) continue;
    const base = project(view.camera, view.viewport, anchor);
    const at = freeSpot(base, hashString(traveler.key), { offset, minGap: radius * MIN_GAP_RATIO, taken });
    taken.push(at);
    placed.push({ traveler, at, radius, color: personColorOf(traveler.key) });
  }
  return placed;
}

/**
 * ほかの旅人の基準点（広域は地区の中心。地区・詳細は地区内のスポットをキーから1つ選ぶ。スポットが無ければ地区の中心）を返す。
 * @param traveler ほかの旅人
 * @param vm 描画データ
 * @param zoom ズーム段階
 * @returns 緯度経度（地区が見つからなければ undefined）
 */
function anchorOf(traveler: OtherTravelerDto, vm: MapViewModel, zoom: MapZoom): { readonly lat: number; readonly lng: number } | undefined { // audit-ignore: fnlog-missing 毎フレーム描画
  const center = vm.districts.find((d) => d.id === traveler.districtId)?.center;
  if (zoom === 'wide') return center;
  const spots = vm.spots.filter((s) => s.districtId === traveler.districtId);
  const spot = spots[hashString(traveler.key) % Math.max(1, spots.length)];
  return spot?.position ?? center;
}

/**
 * 基準点のまわりで、ほかの人と重ならない置き場所を探す。
 * @param base 基準点（CSS px）
 * @param seed 最初の向きを決める値
 * @param opts ずらす距離・最小間隔・すでに置いた点
 * @returns 置き場所（CSS px）
 */
function freeSpot(base: Point2D, seed: number, opts: { readonly offset: number; readonly minGap: number; readonly taken: readonly Point2D[] }): Point2D { // audit-ignore: fnlog-missing 毎フレーム描画
  const start = seed % DIRECTIONS;
  let first: Point2D | undefined;
  for (let i = 0; i < DIRECTIONS; i++) {
    // 斜め（22.5° ずらし）から始めると、ピンの真横に出るラベルと重なりにくい
    const angle = ((start + i) % DIRECTIONS) * ((Math.PI * 2) / DIRECTIONS) + Math.PI / DIRECTIONS;
    const at = { x: base.x + Math.cos(angle) * opts.offset, y: base.y + Math.sin(angle) * opts.offset };
    first ??= at;
    if (opts.taken.every((p) => Math.hypot(p.x - at.x, p.y - at.y) >= opts.minGap)) return at;
  }
  return first ?? base;
}

/**
 * タップした点にいるほかの旅人を返す（近い順に1人）。
 * @param people 画面上のほかの旅人
 * @param tap タップした点（canvas 内 CSS px）
 * @returns 見つかった人。いなければ undefined
 */
export function hitTestPerson(people: readonly PlacedPerson[], tap: Point2D): PlacedPerson | undefined {
  const log = logger.fn('hitTestPerson', { people: people.length });
  let best: PlacedPerson | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const person of people) {
    // 足元と体（アバターは足元から上に立つ）の近いほうで判定する
    const distance = Math.min(Math.hypot(person.at.x - tap.x, person.at.y - tap.y), Math.hypot(person.at.x - tap.x, person.at.y - OTHER_BODY_LIFT_PX - tap.y));
    if (distance <= person.radius + PERSON_HIT_SLOP_PX && distance < bestDistance) {
      best = person;
      bestDistance = distance;
    }
  }
  return log.exit(best, best === undefined ? 'なし' : 'あり');
}

/**
 * 歩きの位相を返す（1歩 WALK_STEP_MS で π 進む。sin の符号で左右の足が入れ替わる）。
 * @param t 現在時刻（performance.now()）
 * @returns 位相（ラジアン）
 */
export function walkPhaseOf(t: number): number { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋な算術ヘルパー
  return (t / WALK_STEP_MS) * Math.PI;
}

/**
 * ほかの旅人をタップしたときの案内文を返す。
 * @param traveler ほかの旅人
 * @param districtName 地区名（分からなければ undefined）
 * @returns 案内文
 */
export function personMessageOf(traveler: OtherTravelerDto, districtName: string | undefined): string {
  const log = logger.fn('personMessageOf', { key: traveler.key, isLord: traveler.isLord });
  const where = districtName ?? 'この地区';
  return log.exit(traveler.isLord ? `${traveler.name}：${where}の主です` : `${traveler.name}：${where}によく来ています`);
}

/**
 * ほかの旅人と自分を描く（自分がいちばん上）。drawMap のあとに呼ぶ。
 * @param ctx 2D コンテキスト
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
export function drawPeople(ctx: CanvasRenderingContext2D, input: PeopleDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  for (const person of input.people) drawOtherPerson(ctx, person, input);
  if (input.self === undefined) return;
  if (input.avatar !== undefined) drawSelfAvatar(ctx, input.self, input.avatar, input);
  else drawSelfBadge(ctx, input.self, input);
}

/**
 * ほかの旅人のアバターの装いを返す（ライバルID から決めるので、複数の地区に出ても同じ見た目）。
 * 服の色は人ごとの色（personColorOf）。地区の主は王冠をかぶる。ランキングと同じ決め方（shared/personLook）。
 * @param traveler ほかの旅人
 * @returns 装い
 */
export function travelerLookOf(traveler: OtherTravelerDto): AvatarLook {
  const log = logger.fn('travelerLookOf', { key: traveler.key, isLord: traveler.isLord });
  return log.exit(personLookOf(traveler.key.split(':')[0] ?? traveler.key, traveler.isLord));
}

/**
 * ほかの旅人がどちらを向いて立つか（人ごとに固定。みんなが同じ向きにならないように）。
 * @param key OtherTravelerDto.key
 * @returns 左向きなら true
 */
function facesLeft(key: string): boolean { // audit-ignore: fnlog-missing 毎フレーム描画で呼ぶ純粋なヘルパー
  return hashString(`face:${key.split(':')[0] ?? key}`) % 2 === 1;
}

/**
 * ほかの旅人を描く（アバターの画像が作れればアバター、作れなければ丸いバッジ）。
 * @param ctx 2D コンテキスト
 * @param person 画面上のほかの旅人
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawOtherPerson(ctx: CanvasRenderingContext2D, person: PlacedPerson, input: PeopleDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const sprite = input.dpr === undefined ? undefined : avatarSpriteFor(travelerLookOf(person.traveler), { scale: OTHER_AVATAR_SCALE[input.zoom], dotPx: AVATAR_DOT_PX, dpr: input.dpr });
  if (sprite === undefined) {
    drawOtherBadge(ctx, person, input);
    return;
  }
  const { at, color } = person;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, 9, 3.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = toRgba(color, 0.22);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(at.x, at.y);
  if (facesLeft(person.traveler.key)) ctx.scale(-1, 1);
  ctx.drawImage(sprite.image, -sprite.footX, -sprite.footY, sprite.width, sprite.height);
  ctx.restore();
  if (input.zoom === 'near') drawNameTag(ctx, person.traveler.name.replace(/^(冒険者|旅人)/, ''), { x: at.x, y: at.y + 12 }, { fill: PALETTE.white, text: color, scale: input.textScale });
}

/**
 * ほかの旅人のバッジ（白い丸＋色の縁＋頭文字。主は王冠つき。詳細では名前も）を描く。
 * @param ctx 2D コンテキスト
 * @param person 画面上のほかの旅人
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawOtherBadge(ctx: CanvasRenderingContext2D, person: PlacedPerson, input: PeopleDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { at, radius: r, color } = person;
  ctx.save();
  ctx.shadowColor = 'rgba(42, 33, 27, 0.28)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = color;
  ctx.lineWidth = input.zoom === 'wide' ? 2 : 2.5;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = canvasFont(r * 1.05, 700, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(person.traveler.initial, at.x, at.y + r * 0.06);
  ctx.restore();
  if (person.traveler.isLord) drawCrown(ctx, { x: at.x, y: at.y - r - (input.zoom === 'wide' ? 3 : 4) }, input.zoom === 'wide' ? 10 : 14);
  if (input.zoom === 'near') drawNameTag(ctx, person.traveler.name.replace(/^(冒険者|旅人)/, ''), { x: at.x, y: at.y + r + 9 }, { fill: PALETTE.white, text: color, scale: input.textScale });
}

/**
 * 自分のバッジ（朱の丸＋白い縁＋白抜きの人型）を描く。地区・詳細では足と「あなた」を添える。
 * 歩いているとき（input.walkPhase あり）は、体が上下に弾んで左右に揺れ、足が交互に上がる。光の輪と影は地面に残す。
 * @param ctx 2D コンテキスト
 * @param at 現在地（CSS px。足元の基準）
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawSelfBadge(ctx: CanvasRenderingContext2D, at: Point2D, input: PeopleDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = SELF_RADIUS[input.zoom];
  const swing = input.walkPhase === undefined ? 0 : Math.sin(input.walkPhase);
  const body = { x: at.x, y: at.y - Math.abs(swing) * WALK_BOB_PX };
  ctx.save();
  const halo = ctx.createRadialGradient(at.x, at.y, r * 0.8, at.x, at.y, r * 2.1);
  halo.addColorStop(0, toRgba(PALETTE.brand, 0.3));
  halo.addColorStop(1, toRgba(PALETTE.brand, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r * 2.1, 0, Math.PI * 2);
  ctx.fill();
  if (input.zoom !== 'wide') drawFeet(ctx, at, r, input.walkPhase === undefined ? undefined : swing);
  ctx.translate(body.x, body.y);
  ctx.rotate(swing * WALK_TILT_RAD);
  ctx.translate(-body.x, -body.y);
  ctx.shadowColor = 'rgba(120, 30, 10, 0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  ctx.arc(body.x, body.y, r + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = PALETTE.brand;
  ctx.beginPath();
  ctx.arc(body.x, body.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.clip();
  drawPersonGlyph(ctx, body, r);
  ctx.restore();
  if (input.zoom !== 'wide' && input.hideSelfTag !== true) drawNameTag(ctx, 'あなた', { x: at.x, y: at.y + r + 17 }, { fill: PALETTE.brandInk, text: PALETTE.white, scale: input.textScale });
}

/**
 * 自分のアバター（マイ街と同じドット絵）を現在地に立たせる。足元に朱の輪と光を敷き、「あなた」を添える。
 * 歩いているときは1歩ごとに1ドット弾み、左へ歩くときは左右反転して進む向きを向く。
 * @param ctx 2D コンテキスト
 * @param at 現在地（CSS px。足元）
 * @param avatar アバターのドット絵
 * @param input 描画入力
 * @sideEffect ctx に描画する
 */
function drawSelfAvatar(ctx: CanvasRenderingContext2D, at: Point2D, avatar: AvatarSprite, input: PeopleDrawInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const ring = input.zoom === 'wide' ? 9 : 13;
  const hop = input.walkPhase !== undefined && Math.abs(Math.sin(input.walkPhase)) > 0.6 ? AVATAR_DOT_PX : 0;
  ctx.save();
  const halo = ctx.createRadialGradient(at.x, at.y, ring * 0.4, at.x, at.y, ring * 2.2);
  halo.addColorStop(0, toRgba(PALETTE.brand, 0.32));
  halo.addColorStop(1, toRgba(PALETTE.brand, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, ring * 2.2, ring * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, ring, ring * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = toRgba(PALETTE.brand, 0.28);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PALETTE.brand;
  ctx.stroke();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(at.x, at.y - hop);
  if (input.facingLeft === true) ctx.scale(-1, 1);
  ctx.drawImage(avatar.image, -avatar.footX, -avatar.footY, avatar.width, avatar.height);
  ctx.restore();
  // 広域でも「あなた」を添える（王者の台座のアバターと見分ける）。広域は足もとに台座・旗が来るので、札は頭の上に出す
  if (input.hideSelfTag !== true) drawNameTag(ctx, 'あなた', { x: at.x, y: input.zoom === 'wide' ? at.y - avatar.footY - WIDE_SELF_TAG_GAP_PX - (SELF_TAG_H_PX * input.textScale) / 2 : at.y + 19 }, { fill: PALETTE.brandInk, text: PALETTE.white, scale: input.textScale });
}

/** 広域で、自分のアバターの頭と「あなた」の札のあいだに空ける高さ（CSS px） */
const WIDE_SELF_TAG_GAP_PX = 6;
/** 名札の高さ（CSS px、拡大前。drawNameTag と同じ） */
const SELF_TAG_H_PX = 16;
/** 「あなた」の札の幅の半分（CSS px、拡大前のおおよそ） */
const SELF_TAG_HALF_W_PX = 22;

/**
 * 広域で、自分のアバターと頭の上の「あなた」の札が占める矩形を返す（王者の台座をよけさせる判定用）。
 * @param at 現在地（足もと。画面座標）
 * @param avatar 自分のアバターのドット絵
 * @param textScale 文字の拡大率
 * @returns 矩形（画面座標）
 */
export function wideSelfBox(at: Point2D, avatar: AvatarSprite, textScale: number): { x: number; y: number; w: number; h: number } { // audit-ignore: fnlog-missing 毎フレーム描画
  const half = Math.max(avatar.footX, avatar.width - avatar.footX, SELF_TAG_HALF_W_PX * textScale);
  const up = avatar.footY + WIDE_SELF_TAG_GAP_PX + SELF_TAG_H_PX * textScale + 2;
  return { x: at.x - half, y: at.y - up, w: half * 2, h: up + 6 };
}

/**
 * 自分のバッジの足元（地面の影と2つの足）を描く。歩いているときは左右の足が交互に上がる。
 * @param ctx 2D コンテキスト
 * @param at 現在地（CSS px）
 * @param r バッジの半径
 * @param swing 歩きの振れ（-1〜1。立ち止まっているときは undefined）
 * @sideEffect ctx に描画する
 */
function drawFeet(ctx: CanvasRenderingContext2D, at: Point2D, r: number, swing: number | undefined): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const ground = at.y + r + 5;
  ctx.save();
  ctx.fillStyle = 'rgba(42, 33, 27, 0.16)';
  ctx.beginPath();
  ctx.ellipse(at.x, ground + 1.5, r * 0.85, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.brandInk;
  for (const side of [-1, 1]) {
    const lift = swing === undefined ? 0 : Math.max(0, side * swing) * WALK_FOOT_LIFT_PX;
    const stride = swing === undefined ? 0 : side * swing * r * 0.12;
    ctx.beginPath();
    ctx.ellipse(at.x + side * r * 0.36 + stride, ground - lift, r * 0.21, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 白抜きの人型（頭と肩）を描く（呼び出し側で丸く切り抜いておく）。
 * @param ctx 2D コンテキスト
 * @param at バッジの中心
 * @param r バッジの半径
 * @sideEffect ctx に描画する
 */
function drawPersonGlyph(ctx: CanvasRenderingContext2D, at: Point2D, r: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  ctx.arc(at.x, at.y - r * 0.2, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(at.x, at.y + r * 0.78, r * 0.62, r * 0.55, 0, Math.PI, 0);
  ctx.fill();
}

/**
 * バッジの下に小さな名札（角丸の札＋文字）を描く。
 * @param ctx 2D コンテキスト
 * @param text 文字
 * @param at 名札の中心
 * @param style 札の色・文字色・文字拡大の倍率
 * @sideEffect ctx に描画する
 */
function drawNameTag(ctx: CanvasRenderingContext2D, text: string, at: Point2D, style: { readonly fill: string; readonly text: string; readonly scale: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(10, 700, style.scale);
  const w = ctx.measureText(text).width + 10 * style.scale;
  const hgt = 16 * style.scale;
  drawRoundRect(ctx, { x: at.x - w / 2, y: at.y - hgt / 2, width: w, height: hgt }, hgt / 2, { fill: style.fill, stroke: 'rgba(42, 33, 27, 0.12)', lineWidth: 1 });
  ctx.fillStyle = style.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y + 0.5);
  ctx.restore();
}
