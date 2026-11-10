/**
 * @file 王者（地区の領主）の情報カード（presentation/screens/Map/town 層）
 * 2026-11-10 ユーザー指示「王者をアバターつきで見せる。タップして、ユーザ情報表示もしたい」。
 * 広域の王者の台座をタップすると下からせり上がる。アバター（大きく）・名前・どの地区の領主か・直近30日の回数・自分の回数・奪還まで、
 * ライバルならよく来る地区。言葉は最小限にし、数字とアイコンで見せる（memory: 画面は文字を最小限に）。
 * 閉じるボタン・Esc・外側のタップで閉じる。「この地区へ」で中間へ寄る。
 */
import '@/presentation/screens/Map/town/championPopup.css';
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';
import { createAvatarImage } from '@/presentation/shared/avatarImage';
import type { AvatarLook } from '@/presentation/shared/avatarSprite';

const logger = createLogger('presentation/screens/Map/town/ChampionPopup');

/** カードの中身 */
export interface ChampionInfo {
  readonly districtId: string;
  /** 地区の短い名前（'天満'） */
  readonly shortName: string;
  /** '#rrggbb' */
  readonly color: string;
  readonly level: number;
  readonly isLordMe: boolean;
  /** 領主の名前（主なしなら無し） */
  readonly lordName?: string;
  /** 領主の装い（主なし・不明なら無し） */
  readonly look?: AvatarLook;
  readonly lordCount: number;
  readonly myCount: number;
  readonly needed: number;
  readonly lordLost: boolean;
  /** ライバルがよく来るほかの地区（短い名前） */
  readonly haunts: readonly string[];
}

/** カードの操作 */
export interface ChampionPopupHandlers {
  onGo(districtId: string): void;
  onClose(): void;
}

/**
 * 数字の札（大きな数字と小さな見出し）を作る。
 * @param icon アイコン
 * @param value 数字の文字
 * @param label 見出し
 * @param tone 色の種類
 * @returns 要素
 */
function stat(icon: IconName, value: string, label: string, tone: 'lord' | 'me' | 'goal'): HTMLElement {
  const log = logger.fn('stat', { icon, tone });
  return log.exit(
    h('li', { class: ['map-champion__stat', `map-champion__stat--${tone}`] }, [
      h('span', { class: 'map-champion__stat-icon', attrs: { 'aria-hidden': 'true' } }, [createIcon(icon)]),
      h('span', { class: 'map-champion__stat-value', text: value }),
      h('span', { class: 'map-champion__stat-label', text: label }),
    ]),
  );
}

/**
 * 上の舞台（地区の色の光・回る光の筋・台座・アバター・王冠）を作る。
 * @param info 中身
 * @returns 要素
 */
function createStage(info: ChampionInfo): HTMLElement {
  const log = logger.fn('createStage', { hasLord: info.lordName !== undefined });
  const hasLord = info.lordName !== undefined;
  const avatar = info.look === undefined ? undefined : createAvatarImage(info.look, 1.25);
  const stage = h('div', { class: 'map-champion__stage' }, [
    h('span', { class: 'map-champion__rays', attrs: { 'aria-hidden': 'true' } }),
    hasLord && avatar !== undefined
      ? h('span', { class: 'map-champion__avatar' }, [avatar])
      : h('span', { class: 'map-champion__vacant', attrs: { 'aria-hidden': 'true' } }, [createIcon('question')]),
    hasLord ? h('span', { class: 'map-champion__crown', attrs: { 'aria-hidden': 'true' } }, [createIcon('crown')]) : undefined,
    h('span', { class: 'map-champion__pedestal', attrs: { 'aria-hidden': 'true' } }),
  ]);
  setStyle(stage, '--district', info.color);
  return log.exit(stage);
}

/**
 * 数字の札の列（領主の30日の回数・自分の回数・奪還まで）を作る。自分が領主なら領主の回数だけ。
 * @param info 中身
 * @returns 要素
 */
function createStats(info: ChampionInfo): HTMLElement {
  const log = logger.fn('createStats', { isLordMe: info.isLordMe });
  const hasLord = info.lordName !== undefined;
  return log.exit(
    h('ul', { class: 'map-champion__stats' }, [
      hasLord ? stat('crown', `${info.lordCount}回`, '領主・30日', 'lord') : undefined,
      info.isLordMe ? undefined : stat('person', `${info.myCount}回`, 'あなた', 'me'),
      info.isLordMe ? undefined : stat('flag', `あと${Math.max(1, info.needed)}回`, hasLord ? '奪還まで' : '領主まで', 'goal'),
    ]),
  );
}

/**
 * ライバルがよく来るほかの地区（足あとのアイコン＋地区の札）を作る。無ければ undefined。
 * @param info 中身
 * @returns 要素
 */
function createHaunts(info: ChampionInfo): HTMLElement | undefined {
  const log = logger.fn('createHaunts', { count: info.haunts.length });
  if (info.isLordMe || info.haunts.length === 0) return log.exit(undefined);
  return log.exit(
    h('div', { class: 'map-champion__haunts' }, [
      h('span', { class: 'map-champion__haunts-icon', attrs: { 'aria-hidden': 'true' } }, [createIcon('footprints')]),
      ...info.haunts.map((name) => h('span', { class: 'map-champion__chip', text: name })),
    ]),
  );
}

/**
 * カード本体（閉じるボタン・舞台・地区と名前・数字の札・よく来る地区・「この地区へ」）を組み立てる。
 * @param info 中身
 * @param onClose 閉じるボタンを押したとき
 * @param go 「この地区へ」ボタン
 * @returns 要素
 */
function createCard(info: ChampionInfo, onClose: () => void, go: HTMLElement): HTMLElement {
  const log = logger.fn('createCard', { districtId: info.districtId });
  const closeButton = h('button', {
    class: 'map-champion__close',
    attrs: { type: 'button', 'aria-label': '閉じる', 'data-testid': 'champion-close' },
    on: { click: userAction('champion-close', onClose) },
  }, [createIcon('close')]);
  const name = info.isLordMe ? 'あなた' : (info.lordName ?? '空席');
  return log.exit(
    h('div', { class: 'map-champion__card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': `${info.shortName}の領主 ${name}` } }, [
      closeButton,
      createStage(info),
      h('div', { class: 'map-champion__body' }, [
        h('p', { class: 'map-champion__role' }, [h('span', { class: 'map-champion__seal', text: `Lv${info.level}` }), h('span', { text: `${info.shortName}の領主` })]),
        h('h2', { class: 'map-champion__name', attrs: { 'data-testid': 'champion-name' }, text: name }),
        info.lordLost ? h('p', { class: 'map-champion__lost', text: '奪還' }) : undefined,
        createStats(info),
        createHaunts(info),
        go,
      ]),
    ]),
  );
}

/**
 * 王者の情報カードを開く。
 * @param host 重ねる先（地図の領域）
 * @param info 中身
 * @param handlers 操作
 * @returns 閉じる関数
 * @sideEffect host に要素を足す。Esc を購読する（閉じると解除）
 */
export function openChampionPopup(host: HTMLElement, info: ChampionInfo, handlers: ChampionPopupHandlers): () => void {
  const log = logger.fn('openChampionPopup', { districtId: info.districtId, isLordMe: info.isLordMe, hasLord: info.lordName !== undefined });
  let closed = false;
  /** 幕（カードの外側）で押しはじめたか。開くきっかけのタップの click と区別する */
  let pressedOnBackdrop = false;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  /**
   * 閉じる（2回目以降は何もしない）。
   * @param notify onClose を呼ぶか
   * @sideEffect DOM を外し、Esc の購読を解除する
   */
  const close = (notify: boolean): void => {
    const closeLog = logger.fn('close', { closed, notify });
    if (closed) return closeLog.exit(undefined);
    closed = true;
    document.removeEventListener('keydown', onKey);
    root.dataset.open = '0';
    window.setTimeout(() => root.remove(), 220);
    previous?.focus();
    if (notify) handlers.onClose();
    closeLog.exit(undefined);
  };
  /**
   * Esc で閉じる。
   * @param e キーの出来事
   * @sideEffect カードを閉じる
   */
  const onKey = (e: KeyboardEvent): void => { // audit-ignore: fnlog-missing キー入力ごとの小さな判定
    if (e.key === 'Escape') close(true);
  };
  const hasLord = info.lordName !== undefined;
  const go = h('button', {
    class: ['btn', 'btn--primary', 'btn--large', 'map-champion__go'],
    attrs: { type: 'button', 'data-testid': 'champion-go' },
    text: 'この地区へ',
    on: { click: userAction('champion-go', () => { close(false); handlers.onGo(info.districtId); }) },
  });
  const card = createCard(info, (): void => close(true), go);
  const root = h('section', {
    class: ['map-champion', info.isLordMe ? 'map-champion--me' : hasLord ? 'map-champion--rival' : 'map-champion--vacant'],
    attrs: { 'data-testid': 'champion-popup', 'data-district-id': info.districtId },
    on: {
      // 幕で押しはじめたタップだけで閉じる。台座をタップした指を離した直後の click は、開いたばかりの幕に当たるので無視する
      // （タッチ操作で「開いてすぐ閉じる」不具合。2026-11-10）
      pointerdown: (e: Event): void => { pressedOnBackdrop = e.target === root; },
      click: (e: Event): void => {
        const pressed = pressedOnBackdrop;
        pressedOnBackdrop = false;
        if (pressed && e.target === root) close(true);
      },
    },
  }, [card]);
  host.append(root);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => {
    root.dataset.open = '1';
    go.focus({ preventScroll: true });
  });
  return log.exit((): void => close(false));
}
