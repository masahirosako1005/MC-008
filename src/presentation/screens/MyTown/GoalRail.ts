/**
 * @file 次のごほうび（絵＋ブロックのゲージで見せる目標カード）（presentation/screens/MyTown 層。DOM 部品）
 * 文字を読まなくても分かるように、アイコン（カード・コイン・アイテム）と、10個のブロックが埋まっていくゲージで進み具合を見せる。
 * 残りは大きな数字1つ（「あと1回」）。まだ持っていないアイテムはシルエット＋「？」。地区のある目標はそのまま地図へ向かえる（基準 C）。
 */
import { createLogger, setCorrelationId } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import type { RewardGoal } from '@/presentation/screens/MyTown/myTownModel';
import { createSprite } from '@/presentation/screens/MyTown/pixelSprites';

const logger = createLogger('presentation/screens/MyTown/GoalRail');

/** ゲージのブロック数 */
const GAUGE_BLOCKS = 10;

/**
 * ブロックのゲージを作る（埋まったブロック＝進み具合）。
 * @param goal 目標
 * @returns 要素（進み具合が無ければ undefined）
 */
function createGauge(goal: RewardGoal): HTMLElement | undefined {
  const log = logger.fn('createGauge', { key: goal.key, progress: goal.progress });
  if (goal.progress === undefined) return log.exit(undefined);
  const filled = Math.round(goal.progress * GAUGE_BLOCKS);
  const blocks = Array.from({ length: GAUGE_BLOCKS }, (_, i) => h('i', { class: ['mytown-gauge__block', i < filled ? 'mytown-gauge__block--on' : undefined] }));
  return log.exit(h('div', { class: ['mytown-gauge', `mytown-gauge--${goal.tone}`], attrs: { role: 'img', 'aria-label': `進み具合 ${Math.round(goal.progress * 100)}%` } }, blocks));
}

/**
 * 目標カード1枚を作る。
 * @param goal 目標
 * @param onGo 地図で向かう（地区のある目標だけ）
 * @returns 要素
 */
function createGoalCard(goal: RewardGoal, onGo: (districtId: string) => void): HTMLElement {
  const log = logger.fn('createGoalCard', { key: goal.key });
  const districtId = goal.districtId;
  const icon = createSprite(goal.icon, 5, goal.kind === 'item' ? 'silhouette' : goal.tone === 'silver' ? 'gray' : 'normal');
  const body = [
    h('span', { class: 'mytown-goal__icon' }, [icon, goal.kind === 'item' ? h('b', { class: 'mytown-goal__q', text: '?' }) : undefined]),
    h('b', { class: 'mytown-goal__title', text: goal.title }),
    createGauge(goal),
    h('span', { class: ['mytown-goal__remain', goal.kind === 'item' ? 'mytown-goal__remain--hint' : undefined], text: goal.remainText }),
  ];
  if (districtId === undefined) return log.exit(h('article', { class: ['mytown-goal', `mytown-goal--${goal.tone}`], attrs: { 'data-testid': `mytown-goal-${goal.key}` } }, body));
  const button = h('button', { class: ['mytown-goal', 'mytown-goal--tap', `mytown-goal--${goal.tone}`], attrs: { type: 'button', 'aria-label': `${goal.title}、${goal.remainText}。地図で向かう`, 'data-testid': `mytown-goal-${goal.key}` } }, [
    ...body,
    h('span', { class: 'mytown-goal__go', attrs: { 'aria-hidden': 'true' } }, [createSprite('pin', 2), '向かう']),
  ]);
  button.addEventListener('click', () => { setCorrelationId(); onGo(districtId); });
  return log.exit(button);
}

/**
 * 次のごほうびの列を作る。目標が無ければ undefined。
 * @param goals 目標
 * @param onGo 地図で向かう
 * @returns 要素
 */
export function createGoalRail(goals: readonly RewardGoal[], onGo: (districtId: string) => void): HTMLElement | undefined {
  const log = logger.fn('createGoalRail', { count: goals.length });
  if (goals.length === 0) return log.exit(undefined);
  return log.exit(h('section', { class: 'mytown-goals', attrs: { 'aria-labelledby': 'mytown-goals-title' } }, [
    h('h2', { class: 'mytown-sub', attrs: { id: 'mytown-goals-title' } }, ['次のごほうび']),
    h('div', { class: 'mytown-goals__rail' }, goals.map((g) => createGoalCard(g, onGo))),
  ]));
}
