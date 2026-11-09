/**
 * @file 準備中画面（presentation/screens/Placeholder 層）
 * PoC で後回しにした画面（ランキング・設定）の代わりに、何の画面か・何を見せる予定かを1行で示す（docs/08 §8）。
 */
import { createLogger } from '@/Common/logging/logger';
import { createButton } from '@/Common/ui/Button';
import { h } from '@/Common/ui/dom';
import { createTopBar } from '@/Common/ui/TopBar';
import type { AppContext } from '@/presentation/App/AppContext';
import type { Screen, ScreenFactory } from '@/presentation/App/Screen';

const logger = createLogger('presentation/screens/Placeholder/PlaceholderScreen');

/** 準備中にしている画面の種類 */
export type PlaceholderKind = 'ranking' | 'settings';

/** 準備中画面の文言 */
interface PlaceholderInfo {
  readonly title: string;
  /** 何を見せる予定か（1行） */
  readonly plan: string;
  /** 判断基準（CLAUDE.md 5 章） */
  readonly criteria: string;
}

/** 種類ごとの文言（CLAUDE.md 6.5〜6.7・8.1） */
export const PLACEHOLDER_INFO: Readonly<Record<PlaceholderKind, PlaceholderInfo>> = {
  ranking: { title: 'ランキング', plan: '今月の通った回数の表彰台と、各地区の領主を見られます。', criteria: 'C 再訪動機' },
  settings: { title: '設定', plan: '文字の大きさ（標準／大／特大）を切り替えられます。', criteria: 'A 初回満足度' },
};

/**
 * 準備中画面のファクトリを作る。
 * @param kind 画面の種類
 * @returns 画面ファクトリ
 */
export function createPlaceholderScreen(kind: PlaceholderKind): ScreenFactory {
  return (ctx: AppContext): Screen => buildPlaceholderScreen(ctx, kind);
}

/**
 * 準備中画面を作る。
 * @param ctx 画面コンテキスト
 * @param kind 画面の種類
 * @returns 画面
 */
function buildPlaceholderScreen(ctx: AppContext, kind: PlaceholderKind): Screen {
  const log = logger.fn('buildPlaceholderScreen', { kind });
  const info = PLACEHOLDER_INFO[kind];
  const screen: Screen = {
    /**
     * 準備中の案内を表示する。
     * @param root 画面のルート要素
     * @sideEffect root に DOM を追加する
     */
    mount(root: HTMLElement): void {
      const mountLog = logger.fn('mount', { kind });
      const back = createButton({ label: '地図へ戻る', variant: 'primary', testId: 'placeholder-back-map', onClick: (): void => ctx.router.navigate('#/map') });
      const body = h('div', { class: 'screen-scroll' }, [
        h('section', { class: 'placeholder', attrs: { 'data-testid': `placeholder-${kind}` } }, [
          h('h2', { class: 'placeholder__title', text: `${info.title}は準備中です` }),
          h('p', { class: 'placeholder__text', text: info.plan }),
          back,
        ]),
      ]);
      root.append(createTopBar({ title: info.title }), body);
      mountLog.exit(undefined);
    },
    /**
     * 後始末する（購読などは無い）。
     */
    unmount(): void {
      logger.fn('unmount', { kind }).exit(undefined);
    },
  };
  return log.exit(screen);
}
