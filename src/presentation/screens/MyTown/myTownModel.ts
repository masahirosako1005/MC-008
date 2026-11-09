/**
 * @file マイ街画面の表示用モデル（presentation/screens/MyTown 層。DOM を使わない純粋関数）
 * 地区カード（DistrictCardDto）から、街並みの絵・地区の詳細・プロフィールに出す値を作る。
 * 成長・色あせの判定は application（DistrictView）が済ませているので、ここでは見せ方だけを決める（D2）。
 * 色あせは見た目だけ。建物の数・Lv・通った回数は色あせで減らさない（CLAUDE.md 4.3）。
 */
import type { DistrictCardDto, FadeDto, MyTownDto, RevisitReasonDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { GOLD_CARD_VISITS, SILVER_CARD_VISITS } from '@/domain/reward/constants';
import { FADE_START_DAYS, MAX_BUILDINGS } from '@/domain/town/constants';
import type { AvatarHeld, AvatarLook } from '@/presentation/screens/MyTown/avatarArt';
import type { SpriteName } from '@/presentation/screens/MyTown/pixelSprites';

const logger = createLogger('presentation/screens/MyTown/myTownModel');

/** 1地区の街並みで建物を置ける場所の数（絵の都合。成長ルールの MAX_BUILDINGS とは別） */
export const SCENE_SLOT_COUNT = 9;

/** 街並みの絵の種類（地区のテーマから決める） */
export type SceneKind = 'shrine' | 'market' | 'park' | 'riverside' | 'castle' | 'harbor' | 'arcade' | 'satoyama' | 'onsen' | 'plain';

/** テーマ → 絵の種類（マスタ districts.json の theme。旧マスタのテーマも残す） */
const SCENE_BY_THEME: Readonly<Record<string, SceneKind>> = {
  門前町: 'shrine',
  市場と食: 'market',
  暮らし: 'plain',
  公園と路地: 'park',
  川辺と桜: 'riverside',
  歴史: 'castle',
  港: 'harbor',
  商店街: 'arcade',
  里山: 'satoyama',
  温泉: 'onsen',
};

/** 色あせメーター（地区の詳細に出す） */
export interface FadeMeter {
  /** 左側の説明 */
  readonly label: string;
  /** 右側の強調（'あと12日' など） */
  readonly value: string;
  /** バーの長さ 0..1（undefined ならバーを出さない） */
  readonly ratio?: number;
  /** 注意色にするか */
  readonly isWarn: boolean;
}

/** 地区の状態の短い表示（地区セレクタ・街並みのラベル用） */
export interface StageText {
  readonly text: string;
  /** 色あせ間近・色あせ中・取り返し中なら true（赤い点・注意色） */
  readonly isWarn: boolean;
}

/**
 * 地区のテーマから街並みの絵の種類を決める。
 * @param theme マスタのテーマ（'歴史' など）
 * @returns 絵の種類（知らないテーマは 'plain'）
 */
export function sceneKindOf(theme: string): SceneKind {
  const log = logger.fn('sceneKindOf', { theme });
  return log.exit(SCENE_BY_THEME[theme] ?? 'plain');
}

/**
 * 地区の建物数（0..MAX_BUILDINGS）を、絵に置く建物の数（0..SCENE_SLOT_COUNT）に換算する。
 * 1軒でも建っていれば最低1つは描く（訪れた手応えを必ず見せる）。
 * @param buildings 地区カードの建物数
 * @returns 絵に置く建物の数
 */
export function builtSlotsOf(buildings: number): number {
  const log = logger.fn('builtSlotsOf', { buildings });
  if (!Number.isFinite(buildings) || buildings <= 0) return log.exit(0);
  const ratio = Math.min(1, buildings / MAX_BUILDINGS);
  return log.exit(Math.max(1, Math.min(SCENE_SLOT_COUNT, Math.ceil(ratio * SCENE_SLOT_COUNT))));
}

/**
 * 色あせ状態から、地区の絵にかける CSS フィルタを決める（見た目だけ。進捗は変えない）。
 * @param fade 色あせ状態
 * @returns ctx.filter に入れる文字列（そのままなら 'none'）
 */
export function fadeFilterOf(fade: FadeDto): string {
  const log = logger.fn('fadeFilterOf', { kind: fade.kind, progress: fade.progress });
  if (fade.kind === 'never') return log.exit('saturate(0)');
  if (fade.kind === 'soon') return log.exit('saturate(0.85)');
  if (fade.kind !== 'fading') return log.exit('none');
  const p = Math.min(1, Math.max(0, fade.progress ?? 0));
  return log.exit(`saturate(${(1 - 0.9 * p).toFixed(2)}) brightness(${(1 + 0.05 * p).toFixed(2)})`);
}

/**
 * 地区の状態を短い言葉にする。
 * @param card 地区カード
 * @returns 表示と注意色にするか
 */
export function stageTextOf(card: DistrictCardDto): StageText {
  const log = logger.fn('stageTextOf', { id: card.id, kind: card.fade.kind, lordLost: card.lordLost });
  if (card.lordLost) return log.exit({ text: '取り返し中', isWarn: true });
  if (card.fade.kind === 'never') return log.exit({ text: '未訪問', isWarn: false });
  if (card.fade.kind === 'soon') return log.exit({ text: 'そろそろ色あせ', isWarn: true });
  if (card.fade.kind === 'fading') return log.exit({ text: '色あせ中', isWarn: true });
  return log.exit({ text: '色あざやか', isWarn: false });
}

/**
 * 色あせメーター（次の色あせまでの残り日数）を作る。
 * @param fade 色あせ状態
 * @returns メーターの表示
 */
export function fadeMeterOf(fade: FadeDto): FadeMeter {
  const log = logger.fn('fadeMeterOf', { kind: fade.kind, daysSinceVisit: fade.daysSinceVisit, daysUntilFade: fade.daysUntilFade });
  if (fade.kind === 'never') return log.exit({ label: 'まだ訪れていません', value: '1回目で色づきます', isWarn: false });
  if (fade.kind === 'fading') {
    const p = Math.min(1, Math.max(0, fade.progress ?? 0));
    return log.exit({ label: '色あせ中（成長はそのまま）', value: '訪れるとすぐ戻ります', ratio: 1 - p, isWarn: true });
  }
  const left = fade.kind === 'soon' ? (fade.daysUntilFade ?? 0) : Math.max(0, FADE_START_DAYS - (fade.daysSinceVisit ?? 0));
  const ratio = Math.min(1, Math.max(0, left / FADE_START_DAYS));
  return log.exit({ label: '色あせが始まるまで', value: `あと${left}日`, ratio, isWarn: fade.kind === 'soon' });
}

/**
 * 地区の主の表示を作る。
 * @param card 地区カード
 * @returns 'あなたが主'／'主を取り返し中'／'主：○○'。主がいなければ undefined
 */
export function lordTextOf(card: DistrictCardDto): string | undefined {
  const log = logger.fn('lordTextOf', { id: card.id, isLordMe: card.isLordMe, lordLost: card.lordLost });
  if (card.isLordMe) return log.exit('あなたが主');
  if (card.lordLost) return log.exit('主を取り返し中');
  return log.exit(card.lordName === undefined ? undefined : `主：${card.lordName}`);
}

/**
 * 最初に見せる地区を決める（おすすめの地区 → 最後に訪れた地区 → 先頭）。
 * @param cards 地区カード（order 順）
 * @param reason いちばん強い再訪理由（無ければ undefined）
 * @returns 地区のインデックス（地区が無ければ 0）
 */
export function initialDistrictIndexOf(cards: readonly DistrictCardDto[], reason: RevisitReasonDto | undefined): number {
  const log = logger.fn('initialDistrictIndexOf', { count: cards.length, reasonDistrictId: reason?.districtId });
  const byReason = reason === undefined ? -1 : cards.findIndex((c) => c.id === reason.districtId);
  if (byReason >= 0) return log.exit(byReason);
  let best = 0;
  let bestDays = Number.POSITIVE_INFINITY;
  cards.forEach((c, i) => {
    const days = c.fade.daysSinceVisit;
    if (days !== undefined && days < bestDays) {
      best = i;
      bestDays = days;
    }
  });
  return log.exit(best);
}

/**
 * アバターが立つ地区（最後に訪れた地区。誰も訪れていなければ先頭）。
 * @param cards 地区カード（order 順）
 * @returns 地区のインデックス
 */
export function avatarDistrictIndexOf(cards: readonly DistrictCardDto[]): number {
  const log = logger.fn('avatarDistrictIndexOf', { count: cards.length });
  return log.exit(initialDistrictIndexOf(cards, undefined));
}

/**
 * プロフィールに出す集計（通った回数の合計・主の地区数）。網羅率は出さない（CLAUDE.md 6.5 と同じ方針）。
 * @param cards 地区カード
 * @returns 合計の通った回数・主の地区数・訪れたことのある地区数
 */
export function profileStatsOf(cards: readonly DistrictCardDto[]): { readonly totalVisits: number; readonly lordCount: number; readonly visitedDistricts: number } {
  const log = logger.fn('profileStatsOf', { count: cards.length });
  const totalVisits = cards.reduce((sum, c) => sum + c.visitCount, 0);
  const lordCount = cards.filter((c) => c.isLordMe).length;
  const visitedDistricts = cards.filter((c) => c.fade.kind !== 'never').length;
  return log.exit({ totalVisits, lordCount, visitedDistricts });
}

/**
 * 旅人の種類の表示名。
 * @param profile アプリ状態の旅人の種類
 * @returns 表示名
 */
export function travelerTitleOf(profile: 'first' | 'regular' | 'user'): string {
  const log = logger.fn('travelerTitleOf', { profile });
  if (profile === 'first') return log.exit('はじめての旅人');
  if (profile === 'regular') return log.exit('通い慣れた旅人');
  return log.exit('旅人');
}

/** アイテムID → 手に持つもの（アイテムの定義は domain/reward/ItemPolicy） */
const HELD_BY_ITEM: Readonly<Record<string, AvatarHeld>> = { i_chochin: 'chochin', i_nobori: 'nobori', i_matsu: 'matsu' };

/**
 * アイテムID から手に持つものを決める（無い・知らない ID はカメラ）。
 * @param itemId 手に持つアイテム
 * @returns 手に持つもの
 */
export function heldOf(itemId: string | undefined): AvatarHeld {
  const log = logger.fn('heldOf', { itemId });
  return log.exit(itemId === undefined ? 'camera' : (HELD_BY_ITEM[itemId] ?? 'camera'));
}

/**
 * アバターの見た目。帽子とねこは通った実績から、手に持つものは着せ替えの選択から決める。
 * @param stats プロフィールの集計
 * @param heldItemId 手に持つアイテム（undefined ならカメラ）
 * @returns 装い
 */
export function avatarLookOf(stats: { readonly totalVisits: number; readonly lordCount: number }, heldItemId?: string): AvatarLook {
  const log = logger.fn('avatarLookOf', { ...stats, heldItemId });
  const hat = stats.lordCount > 0 ? 'crown' : stats.totalVisits > 0 ? 'beret' : undefined;
  return log.exit({ hat, outfitColor: '#6a9bcc', held: heldOf(heldItemId), hasCat: stats.totalVisits >= 10 });
}

/**
 * ランクの進み具合（次のランクまでの割合）。最上位なら 1。
 * @param rank ランク（次の段の閾値・残り）
 * @returns 0..1
 */
export function rankProgressOf(rank: { readonly nextAt?: number; readonly remaining?: number }): number {
  const log = logger.fn('rankProgressOf', rank);
  if (rank.nextAt === undefined || rank.remaining === undefined || rank.nextAt <= 0) return log.exit(1);
  return log.exit(Math.min(1, Math.max(0, 1 - rank.remaining / rank.nextAt)));
}

/**
 * 横スクロールの位置を、範囲内（0..最大）に収める。
 * @param x 左端の位置（CSS px）
 * @param viewWidth 表示幅
 * @param worldWidth 街並み全体の幅
 * @returns 収めた位置
 */
export function clampScrollX(x: number, viewWidth: number, worldWidth: number): number {
  return Math.max(0, Math.min(Math.max(0, worldWidth - viewWidth), x));
}

/**
 * 指定の地区を中央に置くときの左端の位置。
 * @param index 地区のインデックス
 * @param viewWidth 表示幅
 * @param districtWidth 1地区の幅
 * @returns 左端の位置（範囲内に収めない生の値）
 */
export function scrollXForDistrict(index: number, viewWidth: number, districtWidth: number): number {
  return index * districtWidth + districtWidth / 2 - viewWidth / 2;
}

/**
 * 表示の中央にある地区のインデックス。
 * @param x 左端の位置
 * @param viewWidth 表示幅
 * @param districtWidth 1地区の幅
 * @param count 地区の数
 * @returns 0..count-1
 */
export function centerDistrictIndexOf(x: number, viewWidth: number, districtWidth: number, count: number): number { // audit-ignore: fnlog-missing スクロール中に毎フレーム呼ぶ純粋な算術ヘルパー
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor((x + viewWidth / 2) / districtWidth)));
}

/** 街の見出し（ヒーローに出すひと言と、アバターのセリフ） */
export interface TownHeadline {
  /** 見出しのひと言 */
  readonly text: string;
  /** アバターのセリフ（短く） */
  readonly say: string;
  /** 主役の地区（無ければ undefined） */
  readonly districtId?: string;
  /** 急ぐべき知らせか（注意色） */
  readonly isUrgent: boolean;
}

/**
 * いちばん育っている地区（通った回数が最多）を返す。
 * @param cards 地区カード
 * @returns 地区カード（誰も通っていなければ undefined）
 */
function busiestOf(cards: readonly DistrictCardDto[]): DistrictCardDto | undefined {
  const log = logger.fn('busiestOf', { count: cards.length });
  const visited = cards.filter((c) => c.visitCount > 0);
  return log.exit(visited.reduce<DistrictCardDto | undefined>((best, c) => (best === undefined || c.visitCount > best.visitCount ? c : best), undefined));
}

/**
 * 街の状態から、ヒーローに出すひと言を決める（取り返し＞色あせ間近＞色あせ中＞未訪問＞いちばん育った地区）。
 * 色あせは罰にしない言い方にする（「待っています」＝CLAUDE.md 4.3）。
 * @param cards 地区カード（order 順）
 * @returns 見出し
 */
export function headlineOf(cards: readonly DistrictCardDto[]): TownHeadline {
  const log = logger.fn('headlineOf', { count: cards.length });
  const lost = cards.find((c) => c.lordLost);
  if (lost !== undefined) return log.exit({ text: `${lost.name}の主が交代しました。取り返しに行きましょう`, say: `${lost.shortName}を取り返そう！`, districtId: lost.id, isUrgent: true });
  const soon = [...cards].filter((c) => c.fade.kind === 'soon').sort((a, b) => (a.fade.daysUntilFade ?? 99) - (b.fade.daysUntilFade ?? 99))[0];
  if (soon !== undefined) return log.exit({ text: `${soon.name}が、あと${soon.fade.daysUntilFade ?? 0}日で色あせ始めます`, say: `${soon.shortName}に会いに行こう`, districtId: soon.id, isUrgent: true });
  const fading = cards.find((c) => c.fade.kind === 'fading');
  if (fading !== undefined) return log.exit({ text: `${fading.name}が、あなたの帰りを待っています`, say: `${fading.shortName}、ただいま！`, districtId: fading.id, isUrgent: true });
  const never = cards.find((c) => c.fade.kind === 'never');
  if (never !== undefined) return log.exit({ text: `${never.name}はまだ霧の中。最初の1軒で街が生まれます`, say: `${never.shortName}へ行ってみたい！`, districtId: never.id, isUrgent: false });
  const busiest = busiestOf(cards);
  if (busiest === undefined) return log.exit({ text: '最初の1軒を訪れると、ここに街が生まれます', say: 'どこへ行こう？', isUrgent: false });
  return log.exit({ text: `どの地区も色あざやか。${busiest.name}がいちばん育っています`, say: '今日はどこを歩こう？', districtId: busiest.id, isUrgent: false });
}

/** アイテムID → アイコン */
export const SPRITE_BY_ITEM: Readonly<Record<string, SpriteName>> = { i_chochin: 'chochin', i_nobori: 'nobori', i_matsu: 'matsu' };

/** 次のごほうび（進み具合のゲージで見せる） */
export interface RewardGoal {
  readonly key: string;
  /** 'card' はカード、'rank' はランク、'item' はアイテム */
  readonly kind: 'card' | 'rank' | 'item';
  readonly title: string;
  /** 'あと1回' など */
  readonly remainText: string;
  /** 進み具合 0..1（アイテムは undefined） */
  readonly progress?: number;
  /** 地図で向かう先の地区 */
  readonly districtId?: string;
  /** 色（'gold'／'silver'／'rank'／'item'） */
  readonly tone: 'gold' | 'silver' | 'rank' | 'item';
  /** 絵のアイコン */
  readonly icon: SpriteName;
}

/**
 * 次のごほうびを並べる（近いカード2枚 → ランク → まだ持っていないアイテム1つ）。
 * @param dto マイ街
 * @returns ごほうびの一覧
 */
export function rewardGoalsOf(dto: MyTownDto): RewardGoal[] {
  const log = logger.fn('rewardGoalsOf', { nextCards: dto.nextCards.length, locked: dto.lockedItems.length });
  const cards: RewardGoal[] = dto.nextCards.slice(0, 2).map((c) => {
    const need = c.rank === 'gold' ? GOLD_CARD_VISITS : SILVER_CARD_VISITS;
    return {
      key: `card-${c.districtId}-${c.rank}`, kind: 'card', tone: c.rank, icon: 'card',
      title: `${c.districtName}の${c.rank === 'gold' ? '金' : '銀'}カード`,
      remainText: `あと${c.remainingVisits}回`,
      progress: Math.min(1, Math.max(0, (need - c.remainingVisits) / need)),
      districtId: c.districtId,
    };
  });
  const rank: RewardGoal[] = dto.rank.remaining === undefined ? [] : [{ key: 'rank', kind: 'rank', tone: 'rank', icon: 'coin', title: '次のランク', remainText: `あと${dto.rank.remaining}pt`, progress: rankProgressOf(dto.rank) }];
  const lockedItem = dto.lockedItems[0];
  const item: RewardGoal[] = lockedItem === undefined ? [] : [{ key: `item-${lockedItem.itemId}`, kind: 'item', tone: 'item', icon: SPRITE_BY_ITEM[lockedItem.itemId] ?? 'card', title: `アイテム「${lockedItem.name}」`, remainText: lockedItem.hint }];
  return log.exit([...cards, ...rank, ...item]);
}

/** 思い出（年表の1行） */
export interface Memory {
  readonly date: string;
  readonly text: string;
  readonly kind: 'gold' | 'silver' | 'item';
  /** 絵のアイコン */
  readonly icon: SpriteName;
}

/**
 * カードとアイテムの獲得日から、思い出の年表を作る（新しい順）。
 * @param dto マイ街
 * @returns 思い出
 */
export function memoriesOf(dto: MyTownDto): Memory[] {
  const log = logger.fn('memoriesOf', { cards: dto.cards.length, items: dto.items.length });
  const cards: Memory[] = dto.cards.map((c) => ({ date: c.earnedOn, text: `${c.districtName}で${c.rank === 'gold' ? '金' : '銀'}カードを手に入れた`, kind: c.rank, icon: 'card' }));
  const items: Memory[] = dto.items.map((i) => ({ date: i.earnedOn, text: `アイテム「${i.name}」を手に入れた`, kind: 'item', icon: SPRITE_BY_ITEM[i.itemId] ?? 'card' }));
  return log.exit([...cards, ...items].sort((a, b) => b.date.slice(0, 10).localeCompare(a.date.slice(0, 10))));
}
