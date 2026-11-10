/**
 * @file 記録（訪問の年表）の表示（presentation/screens/Zukan 層）
 * 訪問を新しい順に、月の見出しごとに並べる。1件＝日付・時刻・スポット名・地区・「n回目」・思い出のメモ・写真。基準 C（回想が次に通う理由になる）。
 * 写真は、自分の写真があればそれ（「自分の写真」の印つき）、無ければ図鑑と同じスポットの写真（読めなければイラスト）。
 * 1件を押すと思い出の編集（MemoryEditor）を開く。行はすべて 44px 以上のボタン。達成率は出さない。
 */
import '@/presentation/screens/Zukan/VisitLog.css';
import type { VisitLogDto, VisitLogEntryDto } from '@/application/dto/VisitLogDto';
import { createLogger } from '@/Common/logging/logger';
import { h, setStyle } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';
import { createImageBadge } from '@/presentation/screens/Spot/SpotPhotoView';
import { EMPTY_LOG_TEXT, entryAriaLabel, groupByMonth, nthLabel } from '@/presentation/screens/Zukan/visitLogModel';
import { mountCardArt } from '@/presentation/screens/Zukan/ZukanCardArt';
import type { ZukanArtModel } from '@/presentation/screens/Zukan/ZukanCardArt';
import { spotPhotoOf } from '@/presentation/shared/spotPhotos';

const logger = createLogger('presentation/screens/Zukan/VisitLogView');

/** createVisitLogView のオプション */
export interface VisitLogViewOptions {
  readonly dto: VisitLogDto;
  /** 1件が押されたとき（相関ID 発行済み） */
  readonly onOpen: (entry: VisitLogEntryDto) => void;
}

/** 年表の操作 */
export interface VisitLogViewHandle {
  readonly element: HTMLElement;
  /** DOM に入った後にスポットの絵を描く。戻り値で後始末する */
  mountArts(): () => void;
}

/** 絵を描く予定（DOM に入ってから描く） */
interface PendingArt {
  readonly host: HTMLElement;
  readonly model: ZukanArtModel;
}

/**
 * 1件の写真の枠を作る。自分の写真があればその場で入れ、無ければスポットの絵を後から描く予定を積む。
 * @param entry 記録
 * @param pending 絵を描く予定（追記する）
 * @returns 写真の枠
 * @sideEffect pending に追記する
 */
function createThumb(entry: VisitLogEntryDto, pending: PendingArt[]): HTMLElement {
  const log = logger.fn('createThumb', { spotId: entry.spotId, mine: entry.photo !== undefined });
  const thumb = h('span', { class: 'log-entry__thumb', attrs: { 'aria-hidden': 'true' } });
  if (entry.photo !== undefined) {
    thumb.append(h('img', { class: 'log-entry__img', attrs: { src: entry.photo, alt: '', decoding: 'async', draggable: 'false' } }), h('span', { class: 'log-entry__mine' }, [createIcon('camera')]));
    return log.exit(thumb, '自分の写真');
  }
  const photo = spotPhotoOf({ id: entry.spotId, kind: entry.kind, category: entry.category });
  if (photo?.isImage === true) thumb.append(createImageBadge());
  pending.push({ host: thumb, model: { seed: entry.spotId, kind: entry.kind, category: entry.category, status: 'visited', name: entry.spotName, ...(photo === undefined ? {} : { photo }) } });
  return log.exit(thumb, 'スポットの絵');
}

/**
 * 1件（ボタン）を作る。
 * @param entry 記録
 * @param pending 絵を描く予定（追記する）
 * @param onOpen 押されたときの処理
 * @returns button 要素
 */
function createEntry(entry: VisitLogEntryDto, pending: PendingArt[], onOpen: (entry: VisitLogEntryDto) => void): HTMLElement {
  const log = logger.fn('createEntry', { spotId: entry.spotId, localDate: entry.localDate });
  const district = h('span', { class: 'log-entry__district' }, [h('span', { class: 'log-entry__dot' }), entry.districtName]);
  if (entry.districtColor.length > 0) setStyle(district, '--district', entry.districtColor);
  return log.exit(
    h(
      'button',
      {
        class: 'log-entry',
        attrs: { type: 'button', 'aria-label': entryAriaLabel(entry), 'data-testid': 'log-entry', 'data-spot-id': entry.spotId, 'data-date': entry.localDate },
        dataset: { photo: entry.photo === undefined ? '0' : '1', note: entry.note === undefined ? '0' : '1' },
        on: { click: userAction('log-entry', (): void => onOpen(entry)) },
      },
      [
        createThumb(entry, pending),
        h('span', { class: 'log-entry__body', attrs: { 'aria-hidden': 'true' } }, [
          h('span', { class: 'log-entry__when' }, [h('span', { class: 'log-entry__date', text: entry.dateLabel }), h('span', { class: 'log-entry__time', text: entry.time })]),
          h('span', { class: 'log-entry__name', text: entry.spotName }),
          h('span', { class: 'log-entry__meta' }, [district, h('span', { class: 'log-entry__nth', text: nthLabel(entry.nth) })]),
          entry.note === undefined ? undefined : h('span', { class: 'log-entry__note', text: entry.note }),
        ]),
        // 押せる手がかり（右向きの線）。写真かメモを付けた回はチェックを添える
        h('span', { class: 'log-entry__go', attrs: { 'aria-hidden': 'true' } }, [
          entry.photo === undefined && entry.note === undefined ? undefined : h('span', { class: 'log-entry__kept' }, [createIcon('check')]),
          createIcon('chevronRight'),
        ]),
      ],
    ),
  );
}

/**
 * 空の状態（線の絵＋名詞1語）を作る。図鑑の絞り込みで0枚のときと、記録が0件のときに使う。
 * @param icon 線の絵
 * @param text 名詞1語
 * @param testId data-testid
 * @returns 要素
 */
export function createEmptyMark(icon: IconName, text: string, testId: string): HTMLElement {
  const log = logger.fn('createEmptyMark', { icon, testId });
  return log.exit(h('p', { class: 'zukan-empty', attrs: { 'data-testid': testId } }, [h('span', { class: 'zukan-empty__art', attrs: { 'aria-hidden': 'true' } }, [createIcon(icon)]), h('span', { class: 'zukan-empty__text', text })]));
}

/**
 * 記録の年表を作る（月の見出しごと。1件も無ければ案内だけ）。
 * @param opts 記録と押されたときの処理
 * @returns 要素と、DOM に入った後に絵を描く関数
 */
export function createVisitLogView(opts: VisitLogViewOptions): VisitLogViewHandle {
  const log = logger.fn('createVisitLogView', { entries: opts.dto.entries.length });
  const pending: PendingArt[] = [];
  if (opts.dto.entries.length === 0) {
    const empty = createEmptyMark('calendar', EMPTY_LOG_TEXT, 'log-empty');
    return log.exit({ element: empty, mountArts: (): (() => void) => (): void => undefined }, '空');
  }
  const months = groupByMonth(opts.dto.entries).map((month) =>
    h('section', { class: 'log-month', attrs: { 'data-month': month.monthKey } }, [
      h('div', { class: 'zukan-section__head' }, [h('h3', { class: 'zukan-section__title', text: month.monthLabel })]),
      h('div', { class: 'log-list' }, month.entries.map((entry) => createEntry(entry, pending, opts.onOpen))),
    ]),
  );
  const element = h('div', { class: 'log', attrs: { 'data-testid': 'visit-log' } }, months);
  /**
   * 予定しておいたスポットの絵をまとめて描く（年表が DOM に入った後に呼ぶ）。
   * @returns すべての絵を後始末する関数
   * @sideEffect 各行に img（読めなければ canvas）を追加する
   */
  const mountArts = (): (() => void) => {
    const mountLog = logger.fn('mountArts', { count: pending.length });
    const destroyers = pending.map((art) => mountCardArt(art.host, art.model));
    return mountLog.exit((): void => destroyers.forEach((destroy) => destroy()));
  };
  return log.exit({ element, mountArts });
}
