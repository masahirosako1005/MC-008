/**
 * @file 街の上に重ねるもの（presentation/screens/Map/town 層。毎フレーム描く）
 * お店・名所・公衆トイレのドット絵、看板商品の吹き出し、今日だけ・クーポンの印、行きたい・好みのハート、
 * 便利情報フィルタの強調（合うものを光らせ、合わないものを薄く）、陣地の境界と陣取りの演出、チェックインできる円、歩く道筋、地区の札。
 * 「地図だけ見ても行きたくなる」ように、看板商品をアイコンで見せる（未発見の店はシルエット＝B）。座標はログに出さない。
 * 2026-11-10 ユーザー指示「中間は、アイコン消して、吹き出しだけに」: 中間（district）は写真ピン・ドット絵を描かず、town/middleBubbles の吹き出しだけにする。
 * お店の声（town/shopVoices）の吹き出しは registerOverlayHits で当たり判定を足し、タップでそのお店を選べる。
 */
import { canvasFont } from '@/Common/ui/canvas/drawUtils';
import type { Point2D } from '@/Common/ui/canvas/geometry';
import { PALETTE } from '@/Common/ui/theme/palette';
import { project } from '@/presentation/screens/Map/MapViewModel';
import type { Camera, LatLng, Viewport } from '@/presentation/screens/Map/MapViewModel';
import type { GoodsInfo } from '@/presentation/screens/Map/town/goods';
import { drawMiddleBubbles, layoutMiddleBubbles } from '@/presentation/screens/Map/town/middleBubbles';
import type { MiddleCallout } from '@/presentation/screens/Map/town/middleBubbles';
import { drawGoodsPhoto } from '@/presentation/screens/Map/town/goodsPhoto';
import { badgeSpriteSize, drawBadge, drawGoods, drawLandmark, drawToilet, goodsSpriteSize, landmarkSpriteSize, shopSpriteSize } from '@/presentation/screens/Map/town/pixelSprites';
import type { BadgeSprite, LandmarkSprite } from '@/presentation/screens/Map/town/pixelSprites';
import { TERRITORY_MINE_COLOR } from '@/presentation/screens/Map/town/townTypes';

/** 地図の寄り具合（広域・中間・詳細） */
export type SceneTier = 'wide' | 'district' | 'near';

/** 今日の情報（今日だけ・クーポン・イベント） */
export interface SceneToday {
  /** 札の文字（'今日だけ'・'あと3日'・'開催中'） */
  readonly tag: string;
  readonly title: string;
  /** 今日だけ・今日まで（いちばん目立たせる） */
  readonly hot: boolean;
}

/** 地図に置くもの（スポット・公衆トイレ） */
export interface SceneSpot {
  readonly id: string;
  readonly kind: 'landmark' | 'shop' | 'toilet';
  readonly status: 'unknown' | 'discovered' | 'visited';
  readonly name?: string;
  /** カテゴリ（好みの判定に使う。未発見の店でも文字では出さない） */
  readonly category?: string;
  /** 置く位置（街の敷地の中心） */
  readonly ll: LatLng;
  readonly goods?: GoodsInfo;
  readonly landmark?: LandmarkSprite;
  /** 店のひさしの色 */
  readonly awning: string;
  readonly today?: SceneToday;
  readonly amenities: readonly string[];
  readonly visitCount: number;
  /** 行きたいに入れた */
  readonly want: boolean;
  /** 好みに合う */
  readonly liked: boolean;
  /** 地区の色あせ 0..1 */
  readonly fade: number;
  /** 授乳室（トイレのとき） */
  readonly nursing?: boolean;
  /** 見た目のばらつき */
  readonly seed: number;
  /** 地区の色（中間の名所の札に使う。便利施設は無し） */
  readonly districtColor?: string;
}

/** 毎フレームの描画の入力 */
export interface SceneInput {
  readonly camera: Camera;
  readonly vp: Viewport;
  readonly tier: SceneTier;
  readonly t: number;
  readonly textScale: number;
  /** フィルタが有効なとき、合うかどうか（無効なら undefined） */
  readonly matches?: (spot: SceneSpot) => boolean;
  /** 強調の色（フィルタの種類ごと） */
  readonly highlight: string;
  readonly selectedId?: string;
  /** チェックインできる範囲にあるスポット */
  readonly inRange: ReadonlySet<string>;
  /** お店の写真ピンの伸び縮み（チェックインの演出中だけ。横・縦の倍率） */
  readonly pinScale?: (spotId: string) => readonly [number, number];
  /** 中間の吹き出しを置かない場所（地区の布の旗など。画面座標の矩形） */
  readonly reserved?: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
  /** 浮いている部品（上の絞り込みの列・下の左右の部品・お店カード）の下になるので描かないスポット（詳細の表示。地図を動かせばまた出る） */
  readonly hidden?: ReadonlySet<string>;
}

/** 画面に置いたスポット */
export interface PlacedSpot {
  readonly spot: SceneSpot;
  /** 足もと（敷地の中心）の画面座標 */
  readonly x: number;
  readonly y: number;
  /** 描く倍率 */
  readonly scale: number;
  /** 合うか（フィルタ無効なら undefined） */
  readonly match?: boolean;
  /** タップ判定の矩形 */
  readonly hit: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** 吹き出しを出すか */
  readonly bubble: boolean;
  /** 名前を出すか */
  readonly label: boolean;
  /** お店の写真ピンの一辺（CSS px。お店以外・点で描くときは 0） */
  readonly pin: number;
  /** 中間の吹き出し（中間で吹き出しを置けたときだけ。置けなければ点だけ） */
  readonly callout?: MiddleCallout;
  /** 写真ピンを足もとから持ち上げる高さ（CSS px。自分のアバターが手前に立っているときだけ。名前の札は足もとのまま） */
  readonly lift?: number;
  /** 写真ピンを横へずらす幅（CSS px。持ち上げる場所が無いとき。名前の札は足もとのまま） */
  readonly pinDx?: number;
}

/** 画面に重ねた当たり判定（お店の声の吹き出しなど。置いたスポットの配列ごとに覚える） */
export interface OverlayHit {
  readonly spotId: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 置いたスポットの配列 → その上に重ねた当たり判定（フレームごとに配列が変わるので WeakMap で持つ） */
const overlayHits = new WeakMap<readonly PlacedSpot[], readonly OverlayHit[]>();

/**
 * 置いたスポットの上に重ねて描いたもの（お店の声の吹き出し）の当たり判定を覚える。hitTestScene がスポットより先に調べる。
 * @param placed 置いたスポット（placeSpots の戻り値そのもの）
 * @param hits 当たり判定（後のものほど手前）
 * @sideEffect 当たり判定を覚える（前の分は置き換える）
 */
export function registerOverlayHits(placed: readonly PlacedSpot[], hits: readonly OverlayHit[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  overlayHits.set(placed, hits);
}

/** インクの色（輪郭・文字） */
const INK = '#2b2a3a';

/**
 * 寄り具合ごとのスプライトの倍率（0.5 刻み＝高精細画面でドットがそろう）。
 * @param tier 寄り具合
 * @param kind 種類
 * @returns 倍率
 */
export function spriteScale(tier: SceneTier, kind: SceneSpot['kind']): number { // audit-ignore: fnlog-missing 毎フレーム描画
  if (tier === 'near') return kind === 'landmark' ? 1.5 : 1.5;
  if (tier === 'district') return 1;
  return kind === 'landmark' ? 0.75 : 0.5;
}

/**
 * スポットの絵の大きさ（倍率前のドット）。
 * @param spot スポット
 * @returns 幅・高さ
 */
function spriteBox(spot: SceneSpot): { w: number; h: number } { // audit-ignore: fnlog-missing 毎フレーム描画
  if (spot.kind === 'landmark' && spot.landmark !== undefined) return landmarkSpriteSize(spot.landmark);
  if (spot.kind === 'toilet') return { w: 16, h: 16 };
  return shopSpriteSize();
}

/**
 * 見えているスポットを画面に置き、手前（下）ほど後に描く順に並べる。
 * @param spots スポット
 * @param input 描画の入力
 * @returns 置いたスポット
 */
export function placeSpots(spots: readonly SceneSpot[], input: SceneInput): PlacedSpot[] { // audit-ignore: fnlog-missing 毎フレーム描画
  // 中間はアイコンを描かず吹き出しだけ（2026-11-10 ユーザー指示）
  if (input.tier === 'district') return layoutMiddleBubbles(spots, input);
  const out: PlacedSpot[] = [];
  const pad = 80;
  for (const spot of spots) {
    if (input.tier === 'wide' && spot.kind === 'toilet' && input.matches === undefined && !spot.want) continue;
    const p = project(input.camera, input.vp, spot.ll);
    if (p.x < -pad || p.y < -pad || p.x > input.vp.width + pad || p.y > input.vp.height + pad) continue;
    const match = input.matches?.(spot);
    const emphasized = spot.want || spot.today?.hot === true || match === true || spot.id === input.selectedId;
    const base = spriteScale(input.tier, spot.kind);
    const scale = input.tier === 'wide' && emphasized && spot.kind !== 'landmark' ? 1 : match === true && input.tier !== 'near' ? base + 0.5 : base;
    const box = spriteBox(spot);
    const bubble = spot.kind === 'shop' && spot.goods !== undefined && (input.tier !== 'wide' || emphasized) && match !== false;
    // 広域は地区の札を主役にし、スポットの名前は出さない（詳細で出る。中間は middleBubbles）
    const label = spot.name !== undefined && match !== false && input.tier === 'near';
    const pin = spot.kind === 'shop' && (input.tier !== 'wide' || emphasized) ? pinSize(input.tier, match === true || spot.id === input.selectedId) : 0;
    if (pin > 0) {
      out.push({ spot, x: p.x, y: p.y, scale, match, bubble: false, label, pin, hit: { x: p.x - pin / 2 - 6, y: p.y - pin - PIN_TAIL_PX - 8, w: pin + 12, h: pin + PIN_TAIL_PX + 14 } });
      continue;
    }
    const bubbleH = bubble ? goodsSpriteSize() * scale + 14 : 0;
    const w = Math.max(box.w * scale, 28);
    const h = box.h * scale + bubbleH;
    out.push({ spot, x: p.x, y: p.y, scale, match, bubble, label, pin: 0, hit: { x: p.x - w / 2, y: p.y - h - 4, w, h: h + 10 } });
  }
  return out.sort((a, b) => a.y - b.y);
}

/**
 * タップした所のスポットを返す（手前に描いたものを優先し、ほかに無ければ少し離れていても近いものを拾う）。
 * @param placed 置いたスポット
 * @param tap タップした点
 * @returns スポット（無ければ undefined）
 */
export function hitTestScene(placed: readonly PlacedSpot[], tap: Point2D): SceneSpot | undefined { // audit-ignore: fnlog-missing タップごとに呼ぶ純粋な判定ヘルパー
  const extra = overlayHits.get(placed) ?? [];
  for (let k = extra.length - 1; k >= 0; k--) {
    const r = extra[k];
    if (r === undefined || tap.x < r.x || tap.x > r.x + r.w || tap.y < r.y || tap.y > r.y + r.h) continue;
    const hit = placed.find((p) => p.spot.id === r.spotId && p.match !== false);
    if (hit !== undefined) return hit.spot;
  }
  for (let k = placed.length - 1; k >= 0; k--) {
    const p = placed[k];
    if (p === undefined || p.match === false) continue;
    const r = p.hit;
    if (tap.x >= r.x && tap.x <= r.x + r.w && tap.y >= r.y && tap.y <= r.y + r.h) return p.spot;
  }
  let best: PlacedSpot | undefined;
  let bestD = 26;
  for (const p of placed) {
    if (p.match === false) continue;
    const d = Math.hypot(p.x - tap.x, p.y - 8 - tap.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best?.spot;
}

/**
 * スポットを描く（影 → 強調の輪 → 建物 → 印 → 吹き出し → 名前）。
 * @param ctx 2D コンテキスト
 * @param placed 置いたスポット（描く順）
 * @param input 描画の入力
 * @sideEffect canvas に描く
 */
export function drawSpots(ctx: CanvasRenderingContext2D, placed: readonly PlacedSpot[], input: SceneInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (input.tier === 'district') {
    drawMiddleBubbles(ctx, placed, input);
    return;
  }
  const labels: { x: number; y: number; w: number; h: number }[] = [];
  const shown = input.hidden === undefined ? placed : placed.filter((p) => input.hidden?.has(p.spot.id) !== true);
  for (const p of shown) drawOneSpot(ctx, p, input);
  // 名前は大事なもの（選択中・行きたい・今日だけ）から、重ならない分だけ
  const order = shown.filter((p) => p.label).sort((a, b) => labelPriority(b, input) - labelPriority(a, input));
  for (const p of order) drawLabel(ctx, p, input, labels);
}

/**
 * スポットの絵（写真ピン・今日の札・名前の札）が占める矩形を返す（浮いている部品と重なるかの判定用。詳細の表示）。
 * @param p 置いたスポット
 * @param textScale 文字の拡大率
 * @returns 矩形（画面座標）
 */
function spotFootprint(p: PlacedSpot, textScale: number): { x: number; y: number; w: number; h: number } { // audit-ignore: fnlog-missing 毎フレーム描画
  const labelW = p.label ? (p.spot.name?.length ?? 0) * 11 * textScale + 8 : 0;
  const half = Math.max(p.hit.w / 2, labelW / 2);
  const top = p.hit.y - (p.spot.today === undefined ? 0 : 20);
  const bottom = Math.max(p.hit.y + p.hit.h, p.label ? p.y + 3 + 15 * textScale : 0);
  return { x: p.x - half, y: top, w: half * 2, h: bottom - top };
}

/**
 * 詳細の表示で出ているお店の写真ピンと、お店・名所の名前の札の矩形を返す（「あなた」の札と重ねないための判定用。札の幅は文字数からの見積もり）。
 * @param placed 置いたスポット
 * @param input 描画の入力
 * @returns 矩形（画面座標。詳細の表示でなければ空）
 */
export function spotLabelBoxes(placed: readonly PlacedSpot[], input: SceneInput): { x: number; y: number; w: number; h: number }[] { // audit-ignore: fnlog-missing 毎フレーム描画
  if (input.tier !== 'near') return [];
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  for (const p of placed) {
    if (input.hidden?.has(p.spot.id) === true) continue;
    // 写真ピンは、上の今日の札・選択の矢印まで含める（歩いている途中に「あなた」の札が「あと2日」の札へ重ならないように）
    if (p.pin > 0) boxes.push({ ...p.hit }, pinBox(p, p.spot.id === input.selectedId));
    if (!p.label) continue;
    const w = (p.spot.name?.length ?? 0) * 11 * input.textScale + 8;
    boxes.push({ x: p.x - w / 2, y: p.y + 3, w, h: 15 * input.textScale });
  }
  return boxes;
}

/**
 * 写真ピンが占める矩形（白い縁・しっぽ・上の今日の札・選択の矢印まで。今日の札は写真より広いことがあるので幅も合わせる）。
 * 持ち上げているピン（lift）は持ち上げた位置で返す（矢印は付かない）。
 * @param p 置いたスポット（写真ピン）
 * @param selected 選択中か（上に矢印が付く）
 * @returns 矩形（画面座標）
 */
function pinBox(p: PlacedSpot, selected: boolean): { x: number; y: number; w: number; h: number } { // audit-ignore: fnlog-missing 毎フレーム描画
  const lift = p.lift ?? 0;
  const tag = p.spot.today === undefined ? 0 : p.spot.today.tag.length * 12 + 12;
  const half = Math.max(p.pin / 2 + PIN_FRAME_PX, tag / 2);
  const bottom = p.y - lift;
  const top = bottom - p.pin - PIN_TAIL_PX - PIN_FRAME_PX * 2 - (p.spot.today === undefined ? 0 : 18) - (selected && lift === 0 ? 22 : 0);
  return { x: p.x + (p.pinDx ?? 0) - half, y: top, w: half * 2, h: bottom - top };
}

/**
 * 2つの矩形が重なるか。
 * @param a 矩形
 * @param b 矩形
 * @returns 重なれば true
 */
function boxesOverlap(a: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, b: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * 写真ピンを横へずらした先が空いているか（画面の中で、ほかのスポットの絵・名前の札に重ならない）。
 * @param p ずらす写真ピン
 * @param at ずらした先の矩形
 * @param placed 置いたスポット
 * @param input 描画の入力
 * @param hidden 描いていないスポット（判定から除く）
 * @returns 空いていれば true
 */
function pinSideFree(p: PlacedSpot, at: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, placed: readonly PlacedSpot[], input: SceneInput, hidden: ReadonlySet<string> | undefined): boolean { // audit-ignore: fnlog-missing 毎フレーム描画
  if (at.x < 4 || at.x + at.w > input.vp.width - 4) return false;
  return !placed.some((o) => {
    if (o === p || hidden?.has(o.spot.id) === true) return false;
    const labelW = o.label ? (o.spot.name?.length ?? 0) * 11 * input.textScale + 8 : 0;
    return boxesOverlap(at, o.hit) || (o.label && boxesOverlap(at, { x: o.x - labelW / 2, y: o.y + 3, w: labelW, h: 15 * input.textScale }));
  });
}

/** 自分のアバターをよけている写真ピンの状態（スポットID → 今の持ち上げ幅・横のずれ・よけ方。0＝頭の上、1＝右、-1＝左） */
export type PinLiftState = Map<string, { lift: number; dx: number; side: 0 | 1 | -1 }>;

/**
 * 自分のアバターが写真ピンの手前に立つとき、そのピンを頭の上へ持ち上げる（着いたお店の写真が隠れないように。詳細の表示だけ）。
 * 名前の札は足もとのまま。動かす幅は毎フレーム少しずつ寄せる（急に飛ばない）。歩いている間は行き先のピンだけ（通りすがりのピンは動かさない）。
 * 持ち上げた先が上の部品の下に入るとき（地図が狭いとき）は、空いている横（右→左）へずらす。どこも空いていなければ動かさない。
 * @param placed 置いたスポット
 * @param input 描画の入力
 * @param body 自分のアバターが占める矩形（現在地が無ければ undefined）
 * @param walk 歩いているか・行き先のスポット・持ち上げてよい上端（上の浮いた部品の下端。CSS px）・描いていないスポット（横の空きの判定から除く）
 * @param state よけている状態（呼び出し側が持ち、毎フレーム渡す）
 * @returns 動かした後の並び（動かすものが無ければ placed そのもの）
 * @sideEffect state を更新する
 */
export function liftPins(placed: PlacedSpot[], input: SceneInput, body: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined, walk: { readonly walking: boolean; readonly targetId?: string; readonly minTop: number; readonly hidden?: ReadonlySet<string> }, state: PinLiftState): PlacedSpot[] { // audit-ignore: fnlog-missing 毎フレーム描画
  if (input.tier !== 'near' || body === undefined) {
    state.clear();
    return placed;
  }
  const footY = body.y + body.h - PIN_LIFT_FOOT_PX;
  const seen = new Set<string>();
  const out = placed.map((p) => {
    if (p.pin === 0) return p;
    const id = p.spot.id;
    const box = pinBox(p, false);
    // 足もとがピンの根もとの近く（横は写真の幅の中、縦は少し奥〜手前）にあるとき、体が写真に重なる
    const dy = footY - p.y;
    // 歩いて向かっている行き先のピンと、もう持ち上げているピンは、体が重なる少し手前から持ち上げる（着く直前にピンと今日の札が顔にかからないように）
    const lead = state.has(id) || (walk.walking && id === walk.targetId);
    const onPin = Math.abs(body.x + body.w / 2 - p.x) < box.w / 2 + body.w / 2 + (lead ? PIN_LIFT_LEAD_SIDE_PX : -6) && dy > -(lead ? PIN_LIFT_LEAD_BEHIND_PX : PIN_LIFT_BEHIND_PX) && dy < body.h - PIN_LIFT_FOOT_PX - PIN_TAIL_PX && (!walk.walking || id === walk.targetId);
    // しっぽの先が頭のすぐ上に来る高さ・体の横に並ぶ幅
    const full = Math.max(0, p.y - body.y + 2);
    const shift = box.w / 2 + body.w / 2 + 6;
    const fitsUp = box.y - full >= walk.minTop;
    let st = state.get(id);
    if (st === undefined && !onPin) return p;
    /**
     * そのよけ方ができるか（頭の上＝上の部品の下に入らない。横＝ずらした先が空いている）。
     * @param side よけ方（0＝頭の上・1＝右・-1＝左）
     * @returns できれば true
     */
    const free = (side: 0 | 1 | -1): boolean => (side === 0 ? fitsUp : pinSideFree(p, { ...box, x: box.x + side * shift }, placed, input, walk.hidden)); // audit-ignore: fnlog-missing 毎フレーム描画
    // 今のよけ方が続けられる間は変えない（地図が動いて場所がふさがったら選び直す）
    const side = !onPin ? undefined : st !== undefined && free(st.side) ? st.side : free(0) ? 0 : free(1) ? 1 : free(-1) ? -1 : undefined;
    if (st === undefined) {
      if (side === undefined) return p;
      st = { lift: 0, dx: 0, side };
    } else if (side !== undefined) st.side = side;
    const wanted = side !== undefined;
    const targetLift = wanted && st.side === 0 ? full : 0;
    const targetDx = wanted ? st.side * shift : 0;
    st.lift = Math.abs(targetLift - st.lift) < 0.5 ? targetLift : st.lift + (targetLift - st.lift) * 0.22;
    st.dx = Math.abs(targetDx - st.dx) < 0.5 ? targetDx : st.dx + (targetDx - st.dx) * 0.22;
    if (st.lift === 0 && st.dx === 0) return p;
    state.set(id, st);
    seen.add(id);
    return { ...p, lift: st.lift, pinDx: st.dx, hit: { ...p.hit, x: p.hit.x + st.dx, y: p.hit.y - st.lift } };
  });
  for (const id of [...state.keys()]) if (!seen.has(id)) state.delete(id);
  return seen.size > 0 ? out : placed;
}

/**
 * 自分のアバターをよけて動かしている写真ピンが占める矩形を返す（声の吹き出しを重ねないための判定用）。
 * @param placed 置いたスポット
 * @returns 矩形（画面座標）
 */
export function liftedPinBoxes(placed: readonly PlacedSpot[]): { x: number; y: number; w: number; h: number }[] { // audit-ignore: fnlog-missing 毎フレーム描画
  return placed.filter((p) => p.pin > 0 && ((p.lift ?? 0) > 0 || (p.pinDx ?? 0) !== 0)).map((p) => pinBox(p, false));
}

/**
 * 自分のアバターより手前（下）にある写真ピンを、アバターの上に描き直す（奥から歩いて来るとき、アバターがピンと今日の札の上に乗って見えないように）。
 * よけて動かしているピンと、足もとがピンの根もとのすぐ近くにあるピン（liftPins が頭の上へ持ち上げる範囲）は描き直さない。
 * @param ctx 2D コンテキスト
 * @param placed 置いたスポット
 * @param input 描画の入力
 * @param body 自分のアバターが占める矩形
 * @sideEffect canvas に描く
 */
export function drawPinsOver(ctx: CanvasRenderingContext2D, placed: readonly PlacedSpot[], input: SceneInput, body: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (input.tier !== 'near') return;
  const footY = body.y + body.h - PIN_LIFT_FOOT_PX;
  for (const p of placed) {
    if (p.pin === 0 || input.hidden?.has(p.spot.id) === true || (p.lift ?? 0) > 0 || (p.pinDx ?? 0) !== 0) continue;
    if (p.y - footY < PIN_LIFT_BEHIND_PX || !boxesOverlap(body, pinBox(p, p.spot.id === input.selectedId))) continue;
    drawOneSpot(ctx, p, input);
  }
}

/**
 * 浮いている部品の下になるスポットを選ぶ（詳細の表示で、部品がピン・名前の札を隠さないよう、重なるものは描かない）。
 * @param placed 置いたスポット
 * @param boxes 浮いている部品の矩形（画面座標。空なら何も隠さない）
 * @param textScale 文字の拡大率
 * @param keepId 隠さないスポット（カードを開いているスポット）
 * @returns 描かないスポットの ID
 */
export function hiddenUnder(placed: readonly PlacedSpot[], boxes: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[], textScale: number, keepId: string | undefined): ReadonlySet<string> { // audit-ignore: fnlog-missing 毎フレーム描画
  const hidden = new Set<string>();
  if (boxes.length === 0) return hidden;
  for (const p of placed) {
    if (p.spot.id === keepId) continue;
    const f = spotFootprint(p, textScale);
    if (boxes.some((r) => f.x < r.x + r.w && f.x + f.w > r.x && f.y < r.y + r.h && f.y + f.h > r.y)) hidden.add(p.spot.id);
  }
  return hidden;
}

/**
 * 詳細の表示で、人のアバターに隠れた名前の札だけを人より手前に描き直す（drawSpots と同じ順・同じ置き方で、重なるものだけ描く）。
 * @param ctx 2D コンテキスト
 * @param placed 置いたスポット
 * @param input 描画の入力
 * @param boxes 人が占める矩形（画面座標）
 * @sideEffect canvas に描く
 */
export function drawLabelsOver(ctx: CanvasRenderingContext2D, placed: readonly PlacedSpot[], input: SceneInput, boxes: readonly { x: number; y: number; w: number; h: number }[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (input.tier !== 'near' || boxes.length === 0) return;
  const labels: { x: number; y: number; w: number; h: number }[] = [];
  const order = placed.filter((p) => p.label && input.hidden?.has(p.spot.id) !== true).sort((a, b) => labelPriority(b, input) - labelPriority(a, input));
  for (const p of order) drawLabel(ctx, p, input, labels, boxes);
}

/**
 * 名前を出す優先度。
 * @param p 置いたスポット
 * @param input 描画の入力
 * @returns 大きいほど先
 */
function labelPriority(p: PlacedSpot, input: SceneInput): number { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  return (s.id === input.selectedId ? 100 : 0) + (s.want ? 40 : 0) + (s.today?.hot === true ? 30 : 0) + (p.match === true ? 25 : 0) + (s.kind === 'landmark' ? 20 : 0) + (s.status === 'visited' ? 10 : 0);
}

/**
 * スポットを1つ描く。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @sideEffect canvas に描く
 */
function drawOneSpot(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const alpha = p.match === false ? 0.28 : 1;
  const silhouette = s.status === 'unknown' && s.kind === 'shop';
  // 未発見の店は建物を淡く描き、吹き出しの看板商品だけシルエットにする（何のお店かは近づくと分かる＝B）
  const faded = s.status === 'visited' ? s.fade : Math.max(s.fade, s.status === 'unknown' ? 0.72 : 0);
  const box = spriteBox(s);
  const h = box.h * p.scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (input.tier === 'wide' && s.kind === 'shop' && !p.bubble && p.match !== true && s.id !== input.selectedId) {
    drawDot(ctx, p, s);
    ctx.restore();
    return;
  }
  if (p.pin > 0) {
    drawShopPin(ctx, p, input, silhouette);
    ctx.restore();
    return;
  }
  drawShadow(ctx, p.x, p.y, box.w * p.scale * 0.42);
  if (s.id === input.selectedId) drawGlow(ctx, p.x, p.y - h * 0.45, Math.max(box.w, box.h) * p.scale * 0.62, '#bc5b1b', input.t);
  if (s.kind === 'landmark' && s.landmark !== undefined) drawLandmark(ctx, s.landmark, p.x, p.y, p.scale, { faded });
  else drawToilet(ctx, p.x, p.y, p.scale, { nursing: s.nursing === true });
  drawMarks(ctx, p, input, p.x + (box.w * p.scale) / 2 - 2, p.y - h + 4);
  if (p.bubble && s.goods !== undefined) drawBubble(ctx, p, input, h, silhouette);
  if (s.id === input.selectedId) drawSelectArrow(ctx, p.x, p.y - h - (p.bubble ? goodsSpriteSize() * p.scale + 16 : 4), input.t);
  ctx.restore();
}

/** 写真ピンのしっぽの長さ（CSS px） */
const PIN_TAIL_PX = 9;
/** 写真ピンの白い縁の太さ（CSS px） */
const PIN_FRAME_PX = 3;
/** 自分のアバターの矩形の下端から足もとまで（MapScreen の SELF_BODY.down と同じ。CSS px） */
const PIN_LIFT_FOOT_PX = 12;
/** 足もとがピンの根もとよりこれだけ奥（上）にあっても、ピンを頭の上へ持ち上げる（CSS px） */
const PIN_LIFT_BEHIND_PX = 40;
/** 歩いて向かっている行き先のピンは、足もとがこれだけ奥（上）にある時点から持ち上げ始める（ピンの上の今日の札が顔に届く前。CSS px） */
const PIN_LIFT_LEAD_BEHIND_PX = 84;
/** 同じく、体と写真のあいだが横にこれだけ空いている時点から持ち上げ始める（CSS px） */
const PIN_LIFT_LEAD_SIDE_PX = 24;

/**
 * 寄り具合ごとの写真ピンの大きさ（強調中は少し大きく）。
 * @param tier 寄り具合
 * @param emphasized 強調中か（フィルタに合う・選択中）
 * @returns 一辺（CSS px）
 */
function pinSize(tier: SceneTier, emphasized: boolean): number { // audit-ignore: fnlog-missing 毎フレーム描画
  const base = tier === 'near' ? 46 : tier === 'district' ? 34 : 24;
  return emphasized ? base + 8 : base;
}

/** 写真ピンの枠の形（左上・一辺・角の丸み・縁の色・しっぽの先） */
interface PinFrame {
  readonly x: number;
  readonly tipY: number;
  readonly left: number;
  readonly top: number;
  readonly size: number;
  readonly radius: number;
  readonly ring: string;
}

/**
 * 写真ピンの枠を描く（柔らかい影・地面を指すしっぽ・色の縁。縁に色があるときは内側に白い細い縁）。
 * @param ctx 2D コンテキスト
 * @param frame 枠の形
 * @sideEffect canvas に描く
 */
function drawPinFrame(ctx: CanvasRenderingContext2D, frame: PinFrame): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const { x, tipY, left, top, size, radius, ring } = frame;
  const f = PIN_FRAME_PX;
  ctx.fillStyle = 'rgba(30, 30, 50, 0.22)';
  ctx.beginPath();
  ctx.roundRect(left - f + 1, top - f + 3, size + f * 2, size + f * 2, radius + f);
  ctx.fill();
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.moveTo(x - 6, top + size);
  ctx.lineTo(x + 6, top + size);
  ctx.lineTo(x, tipY - 1);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(left - f, top - f, size + f * 2, size + f * 2, radius + f);
  ctx.fill();
  if (ring === '#ffffff') return;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(left - 1, top - 1, size + 2, size + 2, radius + 1);
  ctx.fill();
}

/**
 * お店を「写真ピン」で描く（白い縁の角丸の写真＋地面を指すしっぽ。訪問済みは朱・行きたいはピンク・今日だけは黄の縁）。
 * 未発見の店は写真をぼかしたシルエットにして「？」を重ねる（何のお店かは近づくと分かる＝B）。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @param silhouette 未発見の店か
 * @sideEffect canvas に描く
 */
function drawShopPin(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput, silhouette: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const size = p.pin;
  const bob = s.today?.hot === true ? Math.sin(input.t / 260) * 1.5 : 0;
  const left = p.x - size / 2;
  const lift = p.lift ?? 0;
  // 横へずらすときは、影・しっぽごと全体を動かす（呼び出し側の save/restore の中）
  if (p.pinDx !== undefined && p.pinDx !== 0) ctx.translate(Math.round(p.pinDx), 0);
  const top = p.y - lift - size - PIN_TAIL_PX - PIN_FRAME_PX + bob;
  const radius = Math.max(4, size * 0.24);
  const f = PIN_FRAME_PX;
  const ring = s.today?.hot === true ? '#ffc83d' : s.want ? '#ff8fab' : s.status === 'visited' ? TERRITORY_MINE_COLOR : '#ffffff';
  drawShadow(ctx, p.x, p.y, Math.max(4, size * 0.22));
  // 2026-11-09 ユーザー指示「フィルターするときにお店のサークル（外枠）いらない」: 輪は選択中のお店だけ
  if (s.id === input.selectedId) drawGlow(ctx, p.x, top + size / 2, size * 0.7, '#bc5b1b', input.t);
  const squash = input.pinScale?.(s.id);
  if (squash !== undefined && (squash[0] !== 1 || squash[1] !== 1)) {
    ctx.translate(p.x, p.y);
    ctx.scale(squash[0], squash[1]);
    ctx.translate(-p.x, -p.y);
  }
  drawPinFrame(ctx, { x: p.x, tipY: p.y - lift, left, top, size, radius, ring });
  drawGoodsPhoto(ctx, s.goods?.icon ?? 'gift', left, top, size, { silhouette, radius });
  if (s.status === 'visited' && s.fade > 0.05) {
    ctx.fillStyle = `rgba(238, 238, 238, ${Math.min(0.6, s.fade * 0.6)})`;
    ctx.beginPath();
    ctx.roundRect(left, top, size, size, radius);
    ctx.fill();
  }
  if (silhouette) drawQuestion(ctx, p.x, top + size / 2, size, input.textScale);
  if (s.today !== undefined && input.tier !== 'wide') drawTodayTag(ctx, p.x, top - f - 2, s.today.tag, s.today.hot, input.textScale);
  drawMarks(ctx, p, input, left + size + f, top + 2);
  // 持ち上げている間（自分がそこに立っている）は矢印を出さない
  if (s.id === input.selectedId && lift === 0) drawSelectArrow(ctx, p.x, top - f - (s.today !== undefined ? 16 : 3), input.t);
}

/**
 * 未発見の店の写真に重ねる「？」。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param size 写真の一辺
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawQuestion(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(Math.max(11, size * 0.42), 800, Math.min(textScale, 1.15));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(43, 42, 58, 0.55)';
  ctx.strokeText('？', x, y + 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('？', x, y + 1);
  ctx.restore();
}

/**
 * 写真ピンの上の「今日だけ」などの小さな札（今日だけ・今日までは黄、それ以外は白地に朱の文字）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param bottom 札の下端
 * @param text 文字
 * @param hot 今日だけ・今日までか
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawTodayTag(ctx: CanvasRenderingContext2D, x: number, bottom: number, text: string, hot: boolean, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(11, 800, Math.min(textScale, 1.15));
  const w = ctx.measureText(text).width + 10;
  const h = 16;
  ctx.fillStyle = hot ? '#ffc83d' : '#ffffff';
  ctx.strokeStyle = hot ? '#e0a100' : 'rgba(188, 91, 27, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, bottom - h, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = hot ? INK : '#a54c14';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, bottom - h / 2 + 0.5);
  ctx.restore();
}

/**
 * 広域で目立たない店を小さな点で描く。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param s スポット
 * @sideEffect canvas に描く
 */
function drawDot(ctx: CanvasRenderingContext2D, p: PlacedSpot, s: SceneSpot): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const r = s.status === 'visited' ? 3 : 2.4;
  ctx.fillStyle = INK;
  ctx.fillRect(Math.round(p.x - r - 1), Math.round(p.y - r - 1), Math.round(r * 2 + 2), Math.round(r * 2 + 2));
  ctx.fillStyle = s.status === 'visited' ? TERRITORY_MINE_COLOR : s.status === 'unknown' ? '#9aa0b5' : s.awning;
  ctx.fillRect(Math.round(p.x - r), Math.round(p.y - r), Math.round(r * 2), Math.round(r * 2));
}

/**
 * 足もとの影（だ円）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 足もと
 * @param rx 横の半径
 * @sideEffect canvas に描く
 */
function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.fillStyle = 'rgba(30, 30, 50, 0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y + 1, Math.max(4, rx), Math.max(2, rx * 0.32), 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 強調の光（ゆっくり脈打つ輪）。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 中心
 * @param r 半径
 * @param color 色
 * @param t 現在時刻
 * @sideEffect canvas に描く
 */
function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const k = 0.5 + 0.5 * Math.sin(t / 260);
  ctx.save();
  ctx.globalAlpha *= 0.22 + 0.18 * k;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r + 4 + k * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.lineDashOffset = -t / 60;
  ctx.beginPath();
  ctx.arc(x, y, r + 6 + k * 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 印（訪問の旗と回数・行きたい・好み・チェックインできる）を絵の右上に並べる。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @param right 印を並べ始める右端（CSS px）
 * @param top 印の中心の高さ（CSS px）
 * @sideEffect canvas に描く
 */
function drawMarks(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput, right: number, top: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const marks: BadgeSprite[] = [];
  if (s.status === 'visited') marks.push('flagMine');
  if (s.want) marks.push('heart');
  else if (s.liked) marks.push('sparkle');
  if (input.inRange.has(s.id) && s.kind !== 'toilet') marks.push('check');
  const scale = input.tier === 'near' ? 1.5 : 1;
  let x = right;
  const y = top;
  for (const mark of marks) {
    const size = badgeSpriteSize(mark) * scale;
    drawBadge(ctx, mark, x, y, scale);
    if (mark === 'flagMine' && s.visitCount > 1 && input.tier !== 'wide') drawCount(ctx, x + size * 0.55, y + size * 0.35, s.visitCount, input.textScale);
    x -= size + 1;
  }
}

/**
 * 訪問回数の小さな数字。
 * @param ctx 2D コンテキスト
 * @param x 左
 * @param y 中心
 * @param count 回数
 * @param textScale 文字の拡大率
 * @sideEffect canvas に描く
 */
function drawCount(ctx: CanvasRenderingContext2D, x: number, y: number, count: number, textScale: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.font = canvasFont(9, 800, textScale);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(`×${count}`, x, y);
  ctx.fillStyle = INK;
  ctx.fillText(`×${count}`, x, y);
}

/**
 * 看板商品の吹き出し（今日だけは黄色、行きたいはピンクの縁）。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @param h 絵の高さ（CSS px）
 * @param silhouette 未発見の店（アイコンをシルエットに）
 * @sideEffect canvas に描く
 */
function drawBubble(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput, h: number, silhouette: boolean): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const icon = goodsSpriteSize() * p.scale;
  const size = icon + 8;
  const bob = s.today?.hot === true ? Math.sin(input.t / 220) * 1.5 : 0;
  const cx = p.x;
  const cy = p.y - h - size / 2 - 3 + bob;
  const left = Math.round(cx - size / 2);
  const top = Math.round(cy - size / 2);
  const fill = s.today?.hot === true ? '#ffe066' : s.today !== undefined ? '#fff4c2' : '#ffffff';
  ctx.fillStyle = INK;
  ctx.fillRect(left - 1, top - 1, size + 2, size + 2);
  ctx.fillStyle = s.want ? '#ff8fab' : INK;
  ctx.fillRect(left - 1, top - 1, size + 2, size + 2);
  ctx.fillStyle = fill;
  ctx.fillRect(left + 1, top + 1, size - 2, size - 2);
  // しっぽ
  ctx.fillStyle = INK;
  ctx.fillRect(Math.round(cx - 2), top + size, 4, 2);
  ctx.fillRect(Math.round(cx - 1), top + size + 2, 2, 2);
  drawGoods(ctx, s.goods?.icon ?? 'gift', cx, cy, p.scale, { silhouette });
  if (s.today !== undefined) drawBadge(ctx, s.today.hot ? 'today' : 'coupon', left + size, top, input.tier === 'near' ? 1.5 : 1);
}

/**
 * 選択中のスポットの上で弾む矢印。
 * @param ctx 2D コンテキスト
 * @param x 中心
 * @param y 下端
 * @param t 現在時刻
 * @sideEffect canvas に描く
 */
function drawSelectArrow(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const bob = Math.round(Math.abs(Math.sin(t / 200)) * 4);
  const top = Math.round(y - 14 - bob);
  ctx.fillStyle = INK;
  ctx.fillRect(Math.round(x - 7), top - 1, 14, 6);
  ctx.fillRect(Math.round(x - 5), top + 5, 10, 3);
  ctx.fillRect(Math.round(x - 3), top + 8, 6, 3);
  ctx.fillStyle = '#bc5b1b';
  ctx.fillRect(Math.round(x - 6), top, 12, 4);
  ctx.fillRect(Math.round(x - 4), top + 4, 8, 3);
  ctx.fillRect(Math.round(x - 2), top + 7, 4, 3);
}

/**
 * 名前の札を描く（ほかの札と重なるなら描かない）。
 * @param ctx 2D コンテキスト
 * @param p 置いたスポット
 * @param input 描画の入力
 * @param taken 描いた札の矩形
 * @param onlyOver 渡したときは、この矩形のどれかに重なる札だけを描く（人の手前に描き直すとき）
 * @sideEffect canvas に描く。taken に追加する
 */
function drawLabel(ctx: CanvasRenderingContext2D, p: PlacedSpot, input: SceneInput, taken: { x: number; y: number; w: number; h: number }[], onlyOver?: readonly { x: number; y: number; w: number; h: number }[]): void { // audit-ignore: fnlog-missing 毎フレーム描画
  const s = p.spot;
  const text = s.today?.hot === true && input.tier === 'near' ? `${s.name ?? ''}` : (s.name ?? '');
  if (text === '') return;
  ctx.font = canvasFont(input.tier === 'near' ? 11 : 10, 700, input.textScale);
  const w = ctx.measureText(text).width + 8;
  const h = 15 * input.textScale;
  const rect = { x: p.x - w / 2, y: p.y + 3, w, h };
  if (taken.some((r) => rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y)) return;
  taken.push(rect);
  if (onlyOver !== undefined && !onlyOver.some((r) => rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y)) return;
  ctx.save();
  ctx.globalAlpha = p.match === false ? 0.3 : 1;
  ctx.fillStyle = s.want ? '#ffe3ea' : s.status === 'visited' ? '#fff1ea' : 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = s.want ? '#ff5a7a' : s.status === 'visited' ? TERRITORY_MINE_COLOR : 'rgba(43,42,58,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, p.x, rect.y + h / 2 + 0.5);
  ctx.restore();
}

/**
 * チェックインできる範囲の円（自分の位置が中心。中に入ったスポットはチェックインできる）。
 * @param ctx 2D コンテキスト
 * @param center 自分の画面座標
 * @param radiusPx 半径（CSS px）
 * @param label 円に添える文字（無ければ添えない）
 * @param textScale 文字の拡大率
 * @param t 現在時刻
 * @param band 文字を置いてよい上下の範囲（浮いている部品の下に入れない。円の上の位置がこの外なら添えない）
 * @sideEffect canvas に描く
 */
export function drawCheckInCircle(ctx: CanvasRenderingContext2D, center: Point2D, radiusPx: number, label: string | undefined, textScale: number, t: number, band?: { readonly top: number; readonly bottom: number }): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (radiusPx < 6) return;
  ctx.save();
  ctx.fillStyle = 'rgba(188, 91, 27, 0.09)';
  ctx.beginPath();
  ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = '#bc5b1b';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.lineDashOffset = -t / 70;
  ctx.stroke();
  const y = center.y - radiusPx - 9;
  const fits = band === undefined || (y - 8 >= band.top && y + 8 <= band.bottom);
  if (label !== undefined && fits) {
    ctx.setLineDash([]);
    ctx.font = canvasFont(11, 800, textScale);
    const w = ctx.measureText(label).width + 10;
    const x = center.x - w / 2;
    ctx.fillStyle = '#bc5b1b';
    ctx.beginPath();
    ctx.roundRect(x, y - 8, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, center.x, y + 0.5);
  }
  ctx.restore();
}

/**
 * これから歩く道筋（点線）と行き先の旗。
 * @param ctx 2D コンテキスト
 * @param points 道筋の画面座標（先頭が今の位置）
 * @param t 現在時刻
 * @sideEffect canvas に描く
 */
export function drawRoute(ctx: CanvasRenderingContext2D, points: readonly Point2D[], t: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  if (points.length < 2) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = '#bc5b1b';
  ctx.lineWidth = 3.5;
  ctx.setLineDash([2, 7]);
  ctx.lineDashOffset = -t / 40;
  ctx.stroke();
  ctx.restore();
}

/**
 * 発見の輪（スポットのまわりに広がる輪）。
 * @param ctx 2D コンテキスト
 * @param at 中心
 * @param k 進み 0..1
 * @sideEffect canvas に描く
 */
export function drawDiscoveryRing(ctx: CanvasRenderingContext2D, at: Point2D, k: number): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = '#ffb400';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(at.x, at.y - 10, 10 + k * 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * 出典の小さな文字（右下のすみ。淡い地の細い帯に 10px）。公衆トイレの位置は OpenStreetMap のデータを使っているため表示する（ODbL）。
 * 上の絞り込みの列・右のお店の列・下の左右の部品のどれにも重ならない位置に固定する（2026-11-10 UI/UX 改善）。
 * @param ctx 2D コンテキスト
 * @param text 出典
 * @param vp 描画領域
 * @param textScale 文字の拡大率
 * @param lift 下端から持ち上げる高さ（CSS px。お店カードを開いている間はカードのすぐ上へ逃がす。0 なら右下のすみ）
 * @param avoid 持ち上げた帯を重ねない矩形（選んだお店のピン・名前の札・自分のアバター。重なる間は描かない）
 * @sideEffect canvas に描く
 */
export function drawAttribution(ctx: CanvasRenderingContext2D, text: string, vp: Viewport, textScale: number, lift = 0, avoid: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[] = []): void { // audit-ignore: fnlog-missing 毎フレーム描画
  ctx.save();
  ctx.font = canvasFont(10, 400, textScale);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const bandH = Math.round(14 * textScale);
  const bandW = Math.ceil(ctx.measureText(text).width) + 12;
  const bottom = vp.height - lift;
  // カードのすぐ上へ逃がした帯が、選んだお店のピン・名前の札・自分のアバターに重なる間は描かない（地図が狭いとき。カードを閉じれば右下のすみに出る）
  if (lift > 0 && avoid.some((r) => boxesOverlap({ x: vp.width - bandW - 10, y: bottom - bandH, w: bandW, h: bandH }, r))) {
    ctx.restore();
    return;
  }
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = PALETTE.paper;
  ctx.beginPath();
  if (lift > 0) ctx.roundRect(vp.width - bandW - 10, bottom - bandH, bandW, bandH, bandH / 2);
  else ctx.roundRect(vp.width - bandW, bottom - bandH, bandW + 8, bandH + 8, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.subInk;
  ctx.fillText(text, vp.width - (lift > 0 ? 16 : 6), bottom - bandH / 2);
  ctx.restore();
}
