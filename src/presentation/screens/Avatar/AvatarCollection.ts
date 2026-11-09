/**
 * @file コレクション（ご当地・季節のセット）のタブの中身（presentation/screens/Avatar 層。DOM 部品）
 * セットをマネキン（いまの顔・髪のアバター）に着せて並べる。まだ持っていない部品も着せて見せ、部品ごとに手に入れ方と進み具合を出す。
 * セットごと試着でき、持っている部品だけ「着る」、地区のセットは「地図で向かう」。いまの季節のセットには印を付ける（C 再訪動機）。
 */
import '@/presentation/screens/Avatar/AvatarCollection.css';
import type { AvatarPartDto, AvatarSetDto } from '@/application/dto/Dto';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createAvatarIcon, iconText } from '@/presentation/screens/Avatar/avatarIcons';
import { SEASON_LABEL, createPlaceTag, createRarityTag, createSeasonIcon } from '@/presentation/screens/Avatar/AvatarPanels';
import { remainingTextOf, slotOfPartId, withSet } from '@/presentation/screens/Avatar/avatarScreenModel';
import { createOutfitThumb, createPartThumb } from '@/presentation/screens/Avatar/partThumb';

const logger = createLogger('presentation/screens/Avatar/AvatarCollection');

/** マネキンに引き継ぐ枠（顔・髪・肌・性別） */
const BASE_SLOTS: ReadonlySet<string> = new Set(['body', 'hair', 'hairColor', 'eyes', 'skin', 'topColor', 'bottom', 'shoes']);

/** createCollectionPanel の入力 */
export interface CollectionInput {
  readonly sets: readonly AvatarSetDto[];
  readonly parts: readonly AvatarPartDto[];
  /** いまの装い（マネキンの顔・髪） */
  readonly outfit: readonly string[];
  /** いまの季節 */
  readonly season: string;
  /** 試着しているセット */
  readonly tryingSetId?: string;
  readonly onTry: (set: AvatarSetDto) => void;
  readonly onWear: (set: AvatarSetDto) => void;
  readonly onGoMap: (districtId?: string) => void;
}

/**
 * 押したときの処理を付けた丸いボタンを作る。
 * @param text ラベル
 * @param handler 押したとき
 * @param opts 主な操作か・押せないか・testid
 * @returns ボタン
 */
function pillButton(text: string, handler: () => void, opts: { readonly primary?: boolean; readonly disabled?: boolean; readonly testId?: string } = {}): HTMLButtonElement {
  const log = logger.fn('pillButton', { text });
  const b = h('button', { class: ['avatar-pill', opts.primary === true ? 'avatar-pill--primary' : undefined], text, attrs: { type: 'button', disabled: opts.disabled === true, 'data-testid': opts.testId } });
  b.addEventListener('click', () => {
    setCorrelationId();
    handler();
  });
  return log.exit(b);
}

/**
 * セットの部品1つの行（小さな絵・名前・持っているか／手に入れ方と進み具合）を作る。
 * @param part 部品
 * @param base マネキンの装い
 * @returns 要素
 */
function createSetPartRow(part: AvatarPartDto, base: readonly string[]): HTMLElement {
  const log = logger.fn('createSetPartRow', { id: part.id, owned: part.owned });
  const status = part.owned
    ? h('span', { class: 'avatar-set__ok' }, [createAvatarIcon('check', 14), h('span', { text: '入手' })])
    : h('span', { class: 'avatar-set__how' }, [createAvatarIcon('lock', 13), h('span', { text: part.hint }), h('em', { text: remainingTextOf(part) })]);
  return log.exit(h('li', { class: ['avatar-set__part', part.owned ? 'avatar-set__part--owned' : undefined] }, [
    h('span', { class: 'avatar-set__part-art' }, [createPartThumb(part.id, base, 34)]),
    h('span', { class: 'avatar-set__part-body' }, [h('span', { class: 'avatar-set__part-name' }, [createRarityTag(part.rarity), h('b', { text: part.name })]), status]),
  ]));
}

/**
 * セットの札（地区の色の札・季節の絵の札）を作る。
 * @param set セット
 * @returns 要素
 */
function createSetTag(set: AvatarSetDto): HTMLElement {
  const log = logger.fn('createSetTag', { id: set.id });
  if (set.kind === 'season' && set.season !== undefined) {
    return log.exit(h('span', { class: ['avatar-place', 'avatar-place--season', 'avatar-place--large'] }, [createSeasonIcon(set.season, 16), h('span', { text: SEASON_LABEL[set.season] ?? set.label })]));
  }
  return log.exit(createPlaceTag({ region: set.label, districtId: set.districtId }) ?? h('span', { text: set.label }));
}

/**
 * 地図で向かう先（地区のセットはその地区、季節のセットはまだ持っていない部品の地区）。
 * @param set セット
 * @param parts セットの部品
 * @returns 地区ID（決まらなければ undefined＝地図全体）
 */
function mapTargetOf(set: AvatarSetDto, parts: readonly AvatarPartDto[]): string | undefined {
  const log = logger.fn('mapTargetOf', { id: set.id });
  return log.exit(set.districtId ?? parts.find((p) => !p.owned && p.districtId !== undefined)?.districtId);
}

/**
 * セット1つのカードを作る。
 * @param set セット
 * @param input コレクションの入力
 * @returns 要素
 */
function createSetCard(set: AvatarSetDto, input: CollectionInput): HTMLElement {
  const log = logger.fn('createSetCard', { id: set.id, owned: set.owned });
  const parts = set.partIds.map((id) => input.parts.find((p) => p.id === id)).filter((p): p is AvatarPartDto => p !== undefined);
  const base = input.outfit.filter((id) => BASE_SLOTS.has(slotOfPartId(id)));
  const complete = set.owned >= set.partIds.length;
  const now = set.season !== undefined && set.season === input.season;
  const trying = input.tryingSetId === set.id;
  const target = mapTargetOf(set, parts);
  return log.exit(h('li', {
    class: ['avatar-set', `avatar-set--${set.kind}`, complete ? 'avatar-set--complete' : undefined, now ? 'avatar-set--now' : undefined, trying ? 'avatar-set--trying' : undefined],
    attrs: { 'data-testid': `avatar-set-${set.id}`, 'data-district-id': set.districtId },
  }, [
    h('div', { class: 'avatar-set__head' }, [
      createSetTag(set), h('b', { class: 'avatar-set__name', text: set.name }),
      now ? h('span', { class: 'avatar-set__now', text: 'いまの季節' }) : undefined,
      h('span', { class: 'avatar-set__count', text: `${set.owned}/${set.partIds.length}` }),
    ]),
    h('div', { class: 'avatar-set__body' }, [
      h('span', { class: 'avatar-set__mannequin' }, [createOutfitThumb(withSet(base, set.partIds), 108), complete ? undefined : createAvatarIcon('lock', 22, 'avatar-set__lock')]),
      h('ul', { class: 'avatar-set__parts' }, parts.map((p) => createSetPartRow(p, base))),
    ]),
    h('div', { class: 'avatar-set__actions' }, [
      pillButton(trying ? '試着中' : '試着', () => input.onTry(set), { testId: `avatar-set-try-${set.id}` }),
      pillButton('着る', () => input.onWear(set), { primary: set.owned > 0, disabled: set.owned === 0, testId: `avatar-set-wear-${set.id}` }),
      complete ? undefined : pillButton(target === undefined ? '地図で探す' : '地図で向かう', () => input.onGoMap(target)),
    ]),
  ]));
}

/**
 * コレクションのタブの中身（ご当地・季節の順。いまの季節のセットを季節の先頭に）を作る。
 * @param input コレクションの入力
 * @returns 要素
 */
export function createCollectionPanel(input: CollectionInput): HTMLElement {
  const log = logger.fn('createCollectionPanel', { sets: input.sets.length, season: input.season });
  const region = input.sets.filter((s) => s.kind === 'region');
  const season = [...input.sets.filter((s) => s.kind === 'season')].sort((a, b) => Number(b.season === input.season) - Number(a.season === input.season));
  return log.exit(h('div', { class: 'avatar-collection', attrs: { 'data-testid': 'avatar-collection' } }, [
    h('h3', { class: 'avatar-sub' }, [iconText(createSeasonIconName(input.season), '季節のコレクション', 20)]),
    h('ul', { class: 'avatar-set-list' }, season.map((s) => createSetCard(s, input))),
    h('h3', { class: 'avatar-sub' }, [iconText('collection', 'ご当地コレクション', 20)]),
    h('ul', { class: 'avatar-set-list' }, region.map((s) => createSetCard(s, input))),
  ]));
}

/**
 * 季節のアイコンの名前（知らない季節はコレクションのアイコン）。
 * @param season 季節
 * @returns アイコンの名前
 */
function createSeasonIconName(season: string): 'spring' | 'summer' | 'autumn' | 'winter' | 'collection' {
  return season === 'spring' || season === 'summer' || season === 'autumn' || season === 'winter' ? season : 'collection';
}
