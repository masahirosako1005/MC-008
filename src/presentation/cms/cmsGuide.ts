/**
 * @file 店舗CMS の「かんたんガイド」（presentation/cms 層）
 * 初めての店主が、このCMSでできること・アプリでの見え方・聞き慣れない言葉を30秒でつかめるようにする。
 * かよいまち特有の言葉（図鑑・期限カード・協力店）は、店主の言葉に言い換えて説明する。
 */
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { openModal } from '@/Common/ui/Modal';

const logger = createLogger('presentation/cms/cmsGuide');

/** ガイドの項目（見出しと説明） */
export const GUIDE_ITEMS: readonly { readonly term: string; readonly text: string }[] = [
  { term: 'このページでできること', text: '営業時間や「子連れOK」などの情報を直す、クーポンやイベントを出す、来店の傾向を見る、の3つです。保存するとアプリにすぐ表示されます。' },
  { term: 'かよいまちアプリ', text: '近くに住む人が街を歩いてお店を見つけ、何度も通うと自分の街が育つアプリです。お店に何度も来てもらうきっかけを作ります。' },
  { term: '図鑑', text: 'お客さんがお店の近くを通ると、アプリの「図鑑」にお店が載ります。図鑑に載ったお店のクーポンが、その人に届きます。' },
  { term: '期限カード', text: 'アプリの地図の下に出る「お知らせ」です。クーポンやイベントが終わる7日前から出て、もう一度来るきっかけになります。' },
  { term: '協力店', text: 'クーポンやイベントを出せるお店です。図鑑では「★2 レア」として目立って表示されます。協力店になりたいときは運営者に相談してください。' },
  { term: 'デモについて', text: '日付はアプリのデモの日付です。保存した内容は、同じブラウザで開いているアプリにすぐ反映されます。' },
];

/**
 * かんたんガイドを開く。
 * @param host モーダルを出す先
 * @sideEffect モーダルを開く
 */
export function openCmsGuide(host: HTMLElement): void {
  const log = logger.fn('openCmsGuide');
  const body = h('dl', { class: 'cms-guide' }, GUIDE_ITEMS.flatMap((item) => [h('dt', { text: item.term }), h('dd', { text: item.text })]));
  openModal({ title: 'かんたんガイド', body, host, testId: 'cms-guide', actions: [{ label: 'わかった', variant: 'primary', testId: 'cms-guide-close', onClick: (): void => undefined }] });
  log.exit(undefined);
}
