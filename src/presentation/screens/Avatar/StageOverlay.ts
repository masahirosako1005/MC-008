/**
 * @file ステージの上に重ねる表示と、ステージの下の操作の列（presentation/screens/Avatar 層。DOM 部品）
 * 上に重ねる: 称号の札＋ニックネーム・ランク（左上）、持っている部品の数・NEW（右上）、試着中の帯（上中央）、ポーズの切替（左下）。
 * 下の操作: 元に戻す・おまかせ・保存の状態。
 * 印はすべて canvas で描く（avatarIcons）。ポーズのボタンには、いまの装いのミニアバターがそのポーズをとる絵を描く。
 */
import type { AvatarClosetDto, AvatarPartDto } from '@/application/dto/Dto';
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { normalizeDpr } from '@/Common/ui/canvas/CanvasBase';
import { h, setStyle } from '@/Common/ui/dom';
import { createAvatarIcon, iconText } from '@/presentation/screens/Avatar/avatarIcons';
import { remainingTextOf } from '@/presentation/screens/Avatar/avatarScreenModel';
import { stageLookOf } from '@/presentation/shared/avatar/avatarLook';
import type { AvatarLook, AvatarPose } from '@/presentation/shared/avatar/avatarLook';
import { drawAvatar } from '@/presentation/shared/avatar/avatarPaint';

const logger = createLogger('presentation/screens/Avatar/StageOverlay');

/** ポーズの切替ボタン（t＝ボタンの絵に使う瞬間の経過秒。ジャンプはいちばん高いところ） */
const POSES: readonly { readonly pose: AvatarPose; readonly t: number; readonly label: string }[] = [
  { pose: 'stand', t: 0, label: 'ふつう' },
  { pose: 'wave', t: 0.17, label: '手をふる' },
  { pose: 'peace', t: 0, label: 'ピース' },
  { pose: 'jump', t: 0.45, label: 'ジャンプ' },
];

/** ポーズのボタンの絵の一辺（CSS px） */
const POSE_ART_PX = 38;

/** 保存の状態 */
export type SaveState = 'saved' | 'saving' | 'error';

/** 保存の状態の文言 */
const SAVE_TEXT: Readonly<Record<SaveState, string>> = { saved: '保存ずみ', saving: '保存中…', error: '保存できませんでした' };

/** createStageOverlay の入力 */
export interface StageOverlayInput {
  readonly closet: AvatarClosetDto;
  readonly parts: readonly AvatarPartDto[];
  /** 表示している装い（試着つき） */
  readonly outfit: readonly string[];
  readonly tryOnId?: string;
  readonly onPose: (pose: AvatarPose) => void;
  readonly onUndo: () => void;
  readonly onRandom: () => void;
}

/** 上に重ねる表示の操作 */
export interface StageOverlayHandle {
  /** ステージの上に重ねる要素 */
  readonly element: HTMLElement;
  /** ステージの下の操作の列 */
  readonly actions: HTMLElement;
  update(outfit: readonly string[], tryOnId: string | undefined, parts: readonly AvatarPartDto[]): void;
  setSaveState(state: SaveState): void;
}

/**
 * 称号の札とニックネームを作る。
 * @param closet アバター画面のデータ
 * @param parts すべての部品
 * @param outfit 表示している装い
 * @returns 要素
 */
function createNamePlate(closet: AvatarClosetDto, parts: readonly AvatarPartDto[], outfit: readonly string[]): HTMLElement {
  const log = logger.fn('createNamePlate', { nickname: closet.nickname });
  const title = parts.find((p) => p.slot === 'title' && outfit.includes(p.id));
  return log.exit(h('div', { class: 'avatar-plate', attrs: { 'data-testid': 'avatar-plate' } }, [
    title === undefined ? undefined : h('span', { class: ['avatar-plate__title', `avatar-plate__title--${title.rarity.toLowerCase()}`] }, [h('span', { class: 'avatar-plate__title-text', text: title.name })]),
    h('b', { class: 'avatar-plate__name', text: closet.nickname }),
    h('span', { class: 'avatar-plate__rank', text: `${closet.rankName}・${closet.points.toLocaleString('ja-JP')}pt` }),
  ]));
}

/**
 * 右上の数字（持っている部品の数・NEW）を作る。
 * @param parts すべての部品
 * @returns 要素
 */
function createMeta(parts: readonly AvatarPartDto[]): HTMLElement {
  const log = logger.fn('createMeta');
  const owned = parts.filter((p) => p.owned).length;
  const fresh = parts.filter((p) => p.isNew).length;
  return log.exit(h('div', { class: 'avatar-meta' }, [
    h('span', { class: 'avatar-meta__chip', attrs: { 'aria-label': `持っているアイテム ${owned}点` } }, [iconText('bag', `${owned}点`, 16)]),
    fresh > 0 ? h('span', { class: 'avatar-meta__chip avatar-meta__chip--new', text: `NEW ${fresh}` }) : undefined,
  ]));
}

/**
 * 試着中の帯を作る。
 * @param parts すべての部品
 * @param tryOnId 試着中の部品
 * @returns 要素（試着していなければ undefined）
 */
function createTryOnRibbon(parts: readonly AvatarPartDto[], tryOnId: string | undefined): HTMLElement | undefined {
  const log = logger.fn('createTryOnRibbon', { tryOnId });
  const part = parts.find((p) => p.id === tryOnId);
  if (part === undefined) return log.exit(undefined);
  const left = remainingTextOf(part);
  return log.exit(h('div', { class: 'avatar-tryon', attrs: { role: 'status' } }, [
    h('div', { class: 'avatar-tryon__row' }, [h('b', { text: '試着中' }), h('span', { text: part.name }), left === '' ? undefined : h('em', { text: left })]),
    h('small', { class: 'avatar-tryon__hint' }, [iconText('key', part.hint, 12)]),
  ]));
}

/**
 * ミニアバターがポーズをとる絵を描く（相棒は描かない）。
 * @param canvas 描画先
 * @param look 装い
 * @param pose ポーズ
 * @param t 経過秒
 */
function paintPoseArt(canvas: HTMLCanvasElement, look: AvatarLook, pose: AvatarPose, t: number): void {
  const log = logger.fn('paintPoseArt', { pose });
  const ctx = canvas.getContext('2d');
  if (ctx === null) return log.fail(undefined, '2D コンテキストを取得できません');
  const dpr = normalizeDpr(window.devicePixelRatio);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, POSE_ART_PX, POSE_ART_PX);
  const scale = (POSE_ART_PX * 1.25) / 86;
  drawAvatar(ctx, { ...look, pet: undefined, hasCat: false }, { x: POSE_ART_PX / 2 - 2 * scale, y: POSE_ART_PX + 7, scale }, { pose, t });
  log.exit(undefined);
}

/** ポーズの切替の操作 */
interface PoseBar {
  readonly element: HTMLElement;
  /** ボタンの絵をいまの装いで描き直す */
  draw(look: AvatarLook): void;
}

/**
 * ポーズの切替を作る（ボタンの絵はミニアバター）。
 * @param onPose 選んだとき
 * @returns 要素と描き直し
 */
function createPoseBar(onPose: (pose: AvatarPose) => void): PoseBar {
  const log = logger.fn('createPoseBar');
  const dpr = normalizeDpr(window.devicePixelRatio);
  const arts = POSES.map(() => {
    const c = h('canvas', { class: 'avatar-pose__art', attrs: { width: Math.round(POSE_ART_PX * dpr), height: Math.round(POSE_ART_PX * dpr), 'aria-hidden': 'true' } });
    setStyle(c, 'width', `${POSE_ART_PX}px`);
    setStyle(c, 'height', `${POSE_ART_PX}px`);
    return c;
  });
  const buttons = POSES.map((p, i) => {
    const button = h('button', { class: 'avatar-pose', attrs: { type: 'button', 'aria-label': p.label, title: p.label, 'aria-pressed': i === 0 ? 'true' : 'false', 'data-testid': `avatar-pose-${p.pose}` } }, [arts[i]]);
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      setCorrelationId();
      buttons.forEach((b) => b.setAttribute('aria-pressed', b === button ? 'true' : 'false'));
      onPose(p.pose);
    });
    return button;
  });
  return log.exit({
    element: h('div', { class: 'avatar-poses', attrs: { role: 'group', 'aria-label': 'ポーズ' } }, buttons),
    draw: (look: AvatarLook): void => POSES.forEach((p, i) => { const art = arts[i]; if (art !== undefined) paintPoseArt(art, look, p.pose, p.t); }),
  });
}

/**
 * ステージの上に重ねる表示と、下の操作の列を作る。
 * @param input アバター画面のデータ・装い・操作
 * @returns 操作
 */
export function createStageOverlay(input: StageOverlayInput): StageOverlayHandle {
  const log = logger.fn('createStageOverlay');
  const top = h('div', { class: 'avatar-overlay__top' });
  const ribbon = h('div', { class: 'avatar-overlay__ribbon' });
  const meta = h('div', { class: 'avatar-overlay__meta' });
  const poses = createPoseBar(input.onPose);
  const element = h('div', { class: 'avatar-overlay' }, [top, ribbon, meta, poses.element]);
  const statusText = h('span', { text: SAVE_TEXT.saved });
  const status = h('span', { class: 'avatar-actions__status', attrs: { role: 'status', 'data-testid': 'avatar-save-state' }, dataset: { state: 'saved' } }, [createAvatarIcon('check', 14, 'avatar-actions__check'), statusText]);
  /**
   * 操作の列のボタンを作る。
   * @param icon アイコン
   * @param label ラベル
   * @param handler 押したとき
   * @returns ボタン
   */
  const action = (icon: 'undo' | 'random', label: string, handler: () => void): HTMLElement => { // audit-ignore: fnlog-missing 2回だけ呼ぶボタンの組み立て
    const b = h('button', { class: ['avatar-action', icon === 'random' ? 'avatar-action--primary' : undefined], attrs: { type: 'button', 'data-testid': `avatar-action-${label}` } }, [createAvatarIcon(icon, 20), label]);
    b.addEventListener('click', handler);
    return b;
  };
  const actions = h('div', { class: 'avatar-actions' }, [action('undo', '元に戻す', input.onUndo), action('random', 'おまかせ', input.onRandom), status]);
  /**
   * 表示を装いに合わせる。
   * @param outfit 表示している装い
   * @param tryOnId 試着中の部品
   * @param parts すべての部品
   */
  const update = (outfit: readonly string[], tryOnId: string | undefined, parts: readonly AvatarPartDto[]): void => {
    const updateLog = logger.fn('update', { tryOnId });
    top.replaceChildren(createNamePlate(input.closet, parts, outfit));
    meta.replaceChildren(createMeta(parts));
    poses.draw(stageLookOf(outfit).avatar);
    const r = createTryOnRibbon(parts, tryOnId);
    ribbon.replaceChildren(...(r === undefined ? [] : [r]));
    updateLog.exit(undefined);
  };
  update(input.outfit, input.tryOnId, input.parts);
  return log.exit({
    element,
    actions,
    update,
    setSaveState: (state: SaveState): void => { statusText.textContent = SAVE_TEXT[state]; status.dataset.state = state; },
  });
}
