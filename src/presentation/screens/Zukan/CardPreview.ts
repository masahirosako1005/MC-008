/**
 * @file 図鑑カードの拡大プレビュー（presentation/screens/Zukan 層）
 * カードをタップすると大きなカードで中身（ピクトグラム・カテゴリ・レア度）と取得方法の手順を見せる。
 * 手順は「済んだ＝✓」「次はこれ＝→」の線アイコンの印つきで、次に何をすればカードが育つかがわかるようにする（基準 B・C）。
 * 発見済み・訪問済みは「スポット詳細へ」で 04 に進める（タップ2回以内＝CLAUDE.md 5）。
 * 未発見も名前・カテゴリは出すが（2026-11-09「すべて表示」）、位置を教えないためスポット詳細へは進めない（B）。
 * 獲得した ★4（SSR 級）は大きなカードにもキラキラの層を重ねる（ShinyLayer）。
 */
import type { ZukanTileDto } from '@/application/dto/Dto';
import { createLogger } from '@/Common/logging/logger';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { openModal } from '@/Common/ui/Modal';
import type { ModalHandle } from '@/Common/ui/Modal';
import { phraseNodes } from '@/presentation/screens/Avatar/phraseBreak';
import { categoryIconOf, isShinyCard, rarityViewOf } from '@/presentation/screens/Zukan/cardFace';
import { createShinyLayer } from '@/presentation/screens/Zukan/ShinyLayer';
import { createImageBadge, createPhotoCredit, mountPhotoImage } from '@/presentation/screens/Spot/SpotPhotoView';
import { spotPhotoOf } from '@/presentation/shared/spotPhotos';
import type { SpotPhoto } from '@/presentation/shared/spotPhotos';
import { tileName } from '@/presentation/screens/Zukan/zukanModel';

const logger = createLogger('presentation/screens/Zukan/CardPreview');

/** 手順の進み具合 */
export type StepState = 'done' | 'next' | 'todo';

/**
 * 取得方法の各手順が済んだか（発見 → 訪問 → 特別な条件。レジェンドは覚醒、スーパーレアは常連、レアは訪問済みで済）。
 * @param tile タイル
 * @param count 手順の数
 * @returns 手順ごとの状態
 */
export function stepStatesOf(tile: ZukanTileDto, count: number): StepState[] {
  const log = logger.fn('stepStatesOf', { status: tile.status, count });
  const specialDone = tile.rarity === 4 ? tile.awakened === true : tile.rarity === 3 ? tile.familiarity === 3 : true;
  const doneCount = tile.status === 'unknown' ? 0 : tile.status === 'discovered' ? 1 : specialDone ? count : 2;
  return log.exit(Array.from({ length: count }, (_, i): StepState => (i < doneCount ? 'done' : i === doneCount ? 'next' : 'todo')));
}

/**
 * 大きなカードの上の写真（読めなければ枠ごと取り除く）。未訪問はモノクロ（CSS）。
 * @param tile タイル
 * @param photo 写真
 * @returns 要素
 */
function createPreviewPhoto(tile: ZukanTileDto, photo: SpotPhoto): HTMLElement {
  const log = logger.fn('createPreviewPhoto', { status: tile.status, isImage: photo.isImage });
  const frame = h('span', { class: 'card-preview__photo' }, [photo.isImage ? createImageBadge() : undefined]);
  const alt = photo.isImage ? `${tile.category ?? ''}のイメージ写真` : `${tileName(tile)}の写真`;
  mountPhotoImage(frame, photo, { alt, onFail: (): void => frame.remove() });
  return log.exit(frame);
}

/**
 * 大きなカード（プレビューの上半分）を作る。
 * @param tile タイル
 * @returns 要素
 */
function createBigCard(tile: ZukanTileDto): HTMLElement {
  const log = logger.fn('createBigCard', { status: tile.status });
  const view = rarityViewOf(tile);
  const shiny = isShinyCard(tile);
  const photo = spotPhotoOf(tile);
  return log.exit(
    h(
      'div',
      {
        class: 'rarity-card card-preview__card',
        dataset: { rarity: String(view.rarity), status: tile.status, awakened: tile.awakened === true ? '1' : undefined, shiny: shiny ? '1' : undefined },
      },
      [
        shiny ? createShinyLayer() : undefined,
        photo === undefined ? undefined : createPreviewPhoto(tile, photo),
        h('span', { class: 'rarity-card__foil', attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'rarity-card__code', text: view.code }),
        h('span', { class: 'rarity-card__icon', attrs: { 'aria-hidden': 'true' }, text: categoryIconOf(tile) }),
        h('span', { class: 'rarity-card__stars', attrs: { 'aria-label': `レア度 ${view.rarity}` }, text: view.stars }),
        h('span', { class: 'rarity-card__rname', text: view.name }),
        h('strong', { class: 'card-preview__name' }, phraseNodes(tileName(tile))),
        h('span', { class: 'card-preview__category', text: tile.category ?? '' }),
      ],
    ),
  );
}

/**
 * 取得方法の手順リストを作る。
 * @param tile タイル
 * @returns 要素
 */
function createSteps(tile: ZukanTileDto): HTMLElement {
  const log = logger.fn('createSteps', { status: tile.status });
  const steps = tile.acquisitionSteps ?? [];
  const states = stepStatesOf(tile, steps.length);
  const spoken: Readonly<Record<StepState, string>> = { done: '済み', next: '次はこれ', todo: 'これから' };
  return log.exit(
    h(
      'ol',
      { class: 'card-preview__steps' },
      steps.map((text, i) => {
        const state = states[i] ?? 'todo';
        const face = stepFaceOf(tile, i);
        // 文は画面に出さず読み上げだけに残す（画面は線の絵＋名詞。済んだ手順にはチェックを重ねる）
        return h('li', { class: 'card-preview__step', dataset: { state }, attrs: { 'aria-label': `${text}。${spoken[state]}` } }, [
          h('span', { class: 'card-preview__step-mark', attrs: { 'aria-hidden': 'true' } }, [
            createIcon(face.icon),
            state === 'done' ? h('span', { class: 'card-preview__step-check' }, [createIcon('check')]) : undefined,
          ]),
          h('span', { class: 'card-preview__step-label', attrs: { 'aria-hidden': 'true' }, text: face.label }),
        ]);
      }),
    ),
  );
}

/**
 * 手順の見せ方（線の絵と名詞）。1つ目＝発見、2つ目＝達成、3つ目はレア度ごと（★2 店頭QR／★3 常連／★4 四季 n/4）。
 * @param tile タイル
 * @param index 手順の番号（0 から）
 * @returns 線の絵と名詞
 */
function stepFaceOf(tile: ZukanTileDto, index: number): { readonly icon: IconName; readonly label: string } {
  const log = logger.fn('stepFaceOf', { rarity: tile.rarity, index });
  if (index === 0) return log.exit({ icon: 'compass', label: '発見' });
  if (index === 1) return log.exit({ icon: 'flag', label: '達成' });
  if (tile.rarity === 4) return log.exit({ icon: 'sparkle', label: `四季 ${tile.seasons?.length ?? 0}/4` });
  if (tile.rarity === 3) return log.exit({ icon: 'star', label: '常連' });
  return log.exit({ icon: 'ticket', label: '店頭QR' });
}

/**
 * プレビューを開く。
 * @param tile タイル
 * @param onOpenSpot スポット詳細へ進む処理（未発見なら使わない＝位置を教えない）
 * @returns モーダルの操作
 * @sideEffect 画面にモーダルを出す
 */
export function openCardPreview(tile: ZukanTileDto, onOpenSpot: (spotId: string) => void): ModalHandle {
  const log = logger.fn('openCardPreview', { status: tile.status, rarity: tile.rarity });
  const spotId = tile.id;
  const photo = spotPhotoOf(tile);
  const body = h('div', { class: 'card-preview', attrs: { 'data-testid': 'zukan-card-preview' } }, [
    createBigCard(tile),
    photo === undefined ? undefined : createPhotoCredit(photo),
    createSteps(tile),
  ]);
  const actions =
    spotId === undefined || tile.status === 'unknown'
      ? [{ label: 'とじる', variant: 'secondary' as const, testId: 'zukan-preview-close', onClick: (): void => undefined }]
      : [
          { label: 'とじる', variant: 'secondary' as const, testId: 'zukan-preview-close', onClick: (): void => undefined },
          { label: '詳細へ', variant: 'primary' as const, testId: 'zukan-preview-open', onClick: (): void => onOpenSpot(spotId) },
        ];
  // 見出しの文字は画面に出さない（CSS で隠す。読み上げ名としては残る）
  const modal = openModal({ title: tile.status === 'unknown' ? '未発見のカード' : 'カード', body, actions, testId: 'zukan-preview' });
  // ボタンの文字は短く「詳細へ」、読み上げ名は行き先が分かる「スポット詳細へ」のままにする
  modal.element.querySelector('[data-testid="zukan-preview-open"]')?.setAttribute('aria-label', 'スポット詳細へ');
  return log.exit(modal);
}
