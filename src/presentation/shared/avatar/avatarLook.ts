/**
 * @file アバターの見た目の型と色の表（presentation/shared/avatar。アバター画面・地図で共有）
 * 部品ID（domain/avatar/AvatarCatalog の 'hair.bob' など '<枠>.<種類>'）を、描画用の AvatarLook に変える。
 * AvatarLook は旧来の4項目（outfitColor・held・hasCat・hat）だけでも描ける（地図のほかの旅人はその4項目で作る）。
 * 省略した項目は既定（ショートの黒髪・にっこり・Tシャツ・デニム・スニーカー）で描く。
 */
import { createLogger } from '@/Common/logging/logger';

const logger = createLogger('presentation/shared/avatar/avatarLook');

/** 髪型 */
export type HairStyle = 'short' | 'bob' | 'long' | 'ponytail' | 'bun' | 'twintail' | 'curly' | 'spiky' | 'sidepart' | 'wolf' | 'braid' | 'afro';
/** 目 */
export type EyeStyle = 'smile' | 'round' | 'calm' | 'sharp' | 'sleepy' | 'wink' | 'sparkle' | 'star';
/** トップス */
export type TopStyle = 'tee' | 'hoodie' | 'shirt' | 'border' | 'knit' | 'cardigan' | 'sailor' | 'happi' | 'yukata' | 'jacket' | 'stadium' | 'apron' | 'kimono'
  | 'umeKimono' | 'edoKimono' | 'retroOnepiece' | 'haoriSakura' | 'tenjinYukata' | 'momijiPoncho' | 'downcoat';
/** ボトムス */
export type BottomStyle = 'denim' | 'shorts' | 'skirt' | 'longskirt' | 'cargo' | 'check' | 'hakama' | 'overall';
/** くつ */
export type ShoeStyle = 'sneaker' | 'loafer' | 'boots' | 'sandal' | 'geta' | 'rain' | 'highcut';
/** 帽子（beret・straw・crown は旧来の値） */
export type AvatarHat = 'beret' | 'straw' | 'crown' | 'cap' | 'knit' | 'hachimaki' | 'flower' | 'catEars' | 'bucket' | 'silk' | 'halo' | 'tiara'
  | 'umeKanzashi' | 'sugegasa' | 'sakuraKanzashi' | 'kitsuneMask' | 'momijiBeret' | 'laurel' | 'nagezukin';
/** アクセサリー */
export type AccessoryStyle = 'glasses' | 'sunglasses' | 'scarf' | 'headphones' | 'ribbon' | 'muffler' | 'bandaid' | 'pochette' | 'medal' | 'wings' | 'heartglasses' | 'earmuffs' | 'silverMedal' | 'bronzeMedal' | 'umeTenugui';
/** 手に持つもの（camera・chochin・nobori・matsu は旧来の値） */
export type AvatarHeld =
  | 'camera' | 'chochin' | 'nobori' | 'matsu' | 'map' | 'guidebook' | 'softcream' | 'takoyaki'
  | 'balloon' | 'umbrella' | 'bouquet' | 'fishing' | 'uchiwa' | 'croquette' | 'sparkler' | 'wand'
  | 'omamori' | 'kushikatsu' | 'kamifusen' | 'filmcamera' | 'dango' | 'kingyo' | 'yakiimo' | 'yukidaruma' | 'cheerFlag' | 'kiriko' | 'sensu';
/** 相棒 */
export type PetStyle = 'cat' | 'shiba' | 'rabbit' | 'hiyoko' | 'tanuki' | 'penguin' | 'pigeon' | 'dragon' | 'fox' | 'unicorn' | 'uso' | 'mejiro' | 'tsukimiUsagi' | 'shingyu';
/** ステージの背景 */
export type BackgroundStyle = 'plain' | 'room' | 'minamimori' | 'tenma' | 'tenroku' | 'ogimachi' | 'okawa' | 'sunset' | 'night' | 'starry' | 'dreamy' | 'idol'
  | 'aquarium' | 'yozakura' | 'snowlight' | 'candy' | 'beach' | 'castle' | 'cafe' | 'galaxy'
  | 'edo' | 'nakazaki' | 'tenjinMatsuri' | 'momiji';
/** ステージに置くもの */
export type ObjectStyle =
  | 'bench' | 'plant' | 'bicycle' | 'vending' | 'lamp' | 'signboard' | 'stall' | 'torii' | 'sakura'
  | 'lantern' | 'postbox' | 'maneki' | 'tanuki' | 'fountain' | 'gacha' | 'fireworks' | 'trophy' | 'heartballoon' | 'dresser' | 'winnerFlag' | 'gojinto' | 'moyooshiDaiko';
/**
 * ポーズ。stand〜peace は基本のポーズ、それ以外はエモートの動き（表情も変わる）。
 * love＝両手をほおに当ててうっとり／dance＝左右に揺れて踊る／laugh＝口を開けて笑いながら弾む／surprise＝両手を上げて目を丸くする
 * tilt＝首をかしげる／sleepy＝目を閉じてうとうと／cry＝目をうるませて手で目元をおさえる／angry＝眉をつり上げ両こぶしを握る
 * cheer＝両手を上げて応援しながら跳ねる／spin＝くるりと回る（左右反転を繰り返す）／bow＝おじぎする
 */
export type AvatarPose =
  | 'stand' | 'wave' | 'jump' | 'peace'
  | 'love' | 'dance' | 'laugh' | 'surprise' | 'tilt' | 'sleepy' | 'cry' | 'angry' | 'cheer' | 'spin' | 'bow';

/** エモート（動き＋吹き出し＋粒。エモートのカテゴリで再生し、決めポーズとして身につけられる） */
export type EmoteStyle =
  | 'love' | 'note' | 'question' | 'laugh' | 'surprise' | 'sleepy' | 'cry' | 'angry' | 'bow'
  | 'cheer' | 'spin' | 'star' | 'idol';

/** オーラ（アバターのまわりにまとう演出） */
export type AuraStyle = 'hearts' | 'stars' | 'sakura' | 'bubbles' | 'notes' | 'snow' | 'butterfly' | 'moon' | 'rainbow' | 'gold';

/** 性別（顔立ちと体つきだけが変わる。服・髪型などの部品は性別に関係なくすべて選べる。neutral は指定しない＝これまでの姿） */
export type BodyType = 'girl' | 'boy' | 'neutral';

/** アバターの装い。旧来の4項目は必須、それ以外は省略すると既定で描く */
export interface AvatarLook {
  /** トップスの色 '#rrggbb' */
  readonly outfitColor: string;
  readonly held: AvatarHeld;
  /** 旧来の相棒のねこ（pet を指定したときは pet を優先） */
  readonly hasCat: boolean;
  readonly hat?: AvatarHat;
  readonly hair?: HairStyle;
  /** 髪の色 '#rrggbb' */
  readonly hairColor?: string;
  readonly eyes?: EyeStyle;
  /** 肌の色 '#rrggbb' */
  readonly skin?: string;
  readonly top?: TopStyle;
  readonly bottom?: BottomStyle;
  readonly shoes?: ShoeStyle;
  readonly accessory?: AccessoryStyle;
  readonly pet?: PetStyle;
  /** 性別（省略時 neutral） */
  readonly body?: BodyType;
}

/** ステージ全体の装い（アバター＋背景・置くもの・称号） */
export interface StageLook {
  readonly avatar: AvatarLook;
  readonly background: BackgroundStyle;
  /** 置くもの（最大3つ。並び順＝左手前・右手前・奥） */
  readonly objects: readonly ObjectStyle[];
  /** 称号の部品ID（無ければ undefined） */
  readonly titleId?: string;
  /** オーラ */
  readonly aura?: AuraStyle;
  /** 決めポーズ（ステージを押したとき・開いたときに出すエモート） */
  readonly emote?: EmoteStyle;
}

/** 動き（ステージで使う。地図など止まった絵では省略） */
export interface AvatarMotion {
  readonly pose: AvatarPose;
  /** 経過秒（呼吸・まばたき・手を振る周期に使う） */
  readonly t: number;
}

/** 既定の色 */
export const DEFAULT_HAIR_COLOR = '#2b2b33';
export const DEFAULT_SKIN = '#f6d3b8';
export const DEFAULT_OUTFIT_COLOR = '#6a9bcc';

/** 髪の色（部品ID の種類 → 色） */
export const HAIR_COLORS: Readonly<Record<string, string>> = {
  black: '#2b2b33', brown: '#5b3a29', chestnut: '#8a4b2a', milktea: '#c9a27e', ash: '#8d97a5',
  sakura: '#f4a3c0', mint: '#7fd1b9', fuji: '#9b8ce0', silver: '#d5dae2', kogane: '#f2c14e',
  // EXP の特典（ランク画面）
  akane: '#b8352c', ruri: '#2f58a8', hisui: '#2f9a74', yozora: '#3a3487',
};
/** 肌の色 */
export const SKIN_COLORS: Readonly<Record<string, string>> = {
  tone1: '#fde4d3', tone2: '#f6d3b8', tone3: '#eec09a', tone4: '#d9a074', tone5: '#b27a52', tone6: '#7d5238',
};
/** トップスの色 */
export const TOP_COLORS: Readonly<Record<string, string>> = {
  coral: '#ff7a5c', navy: '#334a7a', white: '#f4f5f7', mustard: '#f2b53a', leaf: '#4cbf8a',
  sky: '#6a9bcc', lilac: '#a78bfa', charcoal: '#3f4552', sakura: '#f7a8c4', gold: '#e9b830',
  // EXP の特典（ランク画面）
  ruby: '#b0204a', emerald: '#1d9168', platinum: '#c5ccd8',
};

/** 部品ID の形（'<枠>.<種類>'） */
const PART_ID_RE = /^([a-zA-Z]+)\.([a-zA-Z0-9]+)$/;

/**
 * 部品ID を枠と種類に分ける。
 * @param partId 部品ID
 * @returns 枠と種類（形が違えば undefined）
 */
export function splitPartId(partId: string): { readonly slot: string; readonly style: string } | undefined { // audit-ignore: fnlog-missing 部品の数だけ呼ぶ純粋な分解
  const m = PART_ID_RE.exec(partId);
  if (m === null || m[1] === undefined || m[2] === undefined) return undefined;
  return { slot: m[1], style: m[2] };
}

/** 既定の装い（何も選んでいないとき） */
export const DEFAULT_LOOK: AvatarLook = Object.freeze({
  outfitColor: DEFAULT_OUTFIT_COLOR, held: 'camera', hasCat: false, hair: 'short', hairColor: DEFAULT_HAIR_COLOR,
  eyes: 'smile', skin: DEFAULT_SKIN, top: 'tee', bottom: 'denim', shoes: 'sneaker',
});

/** 書き換えられる AvatarLook（組み立て用） */
type MutableLook = { -readonly [K in keyof AvatarLook]: AvatarLook[K] };

/**
 * 1つの部品を装いに当てる。
 * @param look 組み立て中の装い
 * @param slot 枠
 * @param style 種類
 */
function applyPart(look: MutableLook, slot: string, style: string): void { // audit-ignore: fnlog-missing 部品の数だけ呼ぶ純粋な代入
  switch (slot) {
    case 'hair': look.hair = style as HairStyle; break;
    case 'hairColor': look.hairColor = HAIR_COLORS[style] ?? DEFAULT_HAIR_COLOR; break;
    case 'eyes': look.eyes = style as EyeStyle; break;
    case 'skin': look.skin = SKIN_COLORS[style] ?? DEFAULT_SKIN; break;
    case 'top': look.top = style as TopStyle; break;
    case 'topColor': look.outfitColor = TOP_COLORS[style] ?? DEFAULT_OUTFIT_COLOR; break;
    case 'bottom': look.bottom = style as BottomStyle; break;
    case 'shoes': look.shoes = style as ShoeStyle; break;
    case 'hat': look.hat = style as AvatarHat; break;
    case 'accessory': look.accessory = style as AccessoryStyle; break;
    case 'held': look.held = style as AvatarHeld; break;
    case 'pet': look.pet = style as PetStyle; break;
    case 'body': look.body = style as BodyType; break;
    default: break;
  }
}

/**
 * 部品ID の並びから、ステージ全体の装いを作る（知らない ID は無視する）。
 * @param partIds 身につけている部品ID（1枠1つ。置くものは最大3つ）
 * @returns ステージの装い
 */
export function stageLookOf(partIds: readonly string[]): StageLook {
  const log = logger.fn('stageLookOf', { count: partIds.length });
  const look: MutableLook = { ...DEFAULT_LOOK };
  let background: BackgroundStyle = 'dreamy';
  const objects: ObjectStyle[] = [];
  let titleId: string | undefined;
  let aura: AuraStyle | undefined;
  let emote: EmoteStyle | undefined;
  for (const id of partIds) {
    const part = splitPartId(id);
    if (part === undefined) continue;
    if (part.slot === 'background') background = part.style as BackgroundStyle;
    else if (part.slot === 'object') objects.push(part.style as ObjectStyle);
    else if (part.slot === 'title') titleId = id;
    else if (part.slot === 'aura') aura = part.style as AuraStyle;
    else if (part.slot === 'emote') emote = part.style as EmoteStyle;
    else applyPart(look, part.slot, part.style);
  }
  const stage: StageLook = { avatar: Object.freeze(look), background, objects: Object.freeze(objects.slice(0, 3)), titleId, aura, emote };
  return log.exit(Object.freeze(stage));
}

/**
 * 部品ID の並びから、アバターの装いだけを作る（地図など）。
 * @param partIds 身につけている部品ID
 * @returns 装い
 */
export function avatarLookOfParts(partIds: readonly string[]): AvatarLook {
  const log = logger.fn('avatarLookOfParts', { count: partIds.length });
  return log.exit(stageLookOf(partIds).avatar);
}
