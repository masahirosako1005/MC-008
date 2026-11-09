/**
 * @file 画面の共通インターフェース（presentation/App 層）
 * App がルート変化のたびに ScreenFactory で画面を作り、mount／unmount する（docs/08 §6）。
 */
import type { AppContext } from '@/presentation/App/AppContext';

/**
 * 1つの画面。
 * - mount: root（App が用意した空の要素。position:absolute で画面領域いっぱい）に DOM を作る。非同期でもよい。
 * - unmount: 購読解除・タイマー停止・ResizeObserver 解除などの後始末をする（DOM は App が消す）。
 * mount の完了前に unmount されることがある（素早い画面切替）。その場合も安全に後始末できるようにする。
 */
export interface Screen {
  mount(root: HTMLElement): Promise<void> | void;
  unmount(): void;
}

/** 画面を作る関数。params はルーターで検証済み（districtId・spotId は ID 形式を満たす） */
export type ScreenFactory = (ctx: AppContext, params: Readonly<Record<string, string>>) => Screen;
