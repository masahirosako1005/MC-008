/**
 * @file スポットカード（Common/ui/cards 層）
 * 状態アイコン（？＝未発見／ピン＝発見済み（グレー）／✓＝訪問済み（地区色））、名前、種別、距離、補足。wireframes/03_sheet。
 * アイコンは線のアイコン（docs/08 §10.3）。形でも状態を区別する（未発見は破線の枠）。
 * 未発見のスポットは名前を出さない（B: 位置と便利情報だけで興味を引く）。
 */
import { createLogger } from '@/Common/logging/logger';
import { formatDistance } from '@/Common/ui/format';
import { h } from '@/Common/ui/dom';
import { createIcon } from '@/Common/ui/icons';
import type { IconName } from '@/Common/ui/icons';
import { userAction } from '@/Common/ui/userAction';

const logger = createLogger('Common/ui/cards/SpotCard');

/** スポットの状態（application の SpotStatusDto と同じ値） */
export type SpotCardStatus = 'unknown' | 'discovered' | 'visited';

/** 状態ごとのアイコンと読み上げ名 */
export const SPOT_STATUS_ICONS: Readonly<Record<SpotCardStatus, { readonly icon: IconName; readonly name: string }>> = {
  unknown: { icon: 'question', name: '未発見' },
  discovered: { icon: 'pin', name: '発見済み' },
  visited: { icon: 'check', name: '達成済み' },
};

/** 未発見スポットの名前の代わりに出す文言 */
export const UNKNOWN_SPOT_NAME = '？？？';

/** createSpotCard のオプション */
export interface SpotCardOptions {
  readonly status: SpotCardStatus;
  /** 名前（unknown のときは渡さない／渡しても表示しない） */
  readonly name?: string;
  /** 種別ラベル（「名所」「店舗」） */
  readonly kindLabel: string;
  /** 現在地からの距離（メートル） */
  readonly meters?: number;
  /** 補足（「訪問2回」「クーポンあり」など） */
  readonly subtitle?: string;
  /** 右上に出す目立つバッジ（「訪問できます」など） */
  readonly badge?: string;
  readonly onClick?: () => void;
  /** data-spot-id に入れるスポットID（E2E 用） */
  readonly spotId?: string;
  /** data-district-id に入れる地区ID（見た目用。訪問済みアイコン・タグを地区色にする） */
  readonly districtId?: string;
  /** 状態アイコンの代わりに置く要素（丸いサムネなど。読み上げの名前を持たせること） */
  readonly icon?: HTMLElement;
  /** 名前の横に並べる色付きの小さなチップ（「クーポン」など） */
  readonly chips?: readonly string[];
}

/**
 * 状態アイコンを作る。
 * @param status スポットの状態
 * @returns span 要素
 */
export function createSpotStatusIcon(status: SpotCardStatus): HTMLElement {
  const log = logger.fn('createSpotStatusIcon', { status });
  const info = SPOT_STATUS_ICONS[status];
  return log.exit(h('span', { class: 'spot-icon', attrs: { role: 'img', 'aria-label': info.name }, dataset: { status } }, [createIcon(info.icon)]));
}

/**
 * スポットカードを作る（data-testid="spot-card"、data-status=状態）。
 * @param opts 状態・名前・種別・距離・補足・バッジ・タップ時の処理
 * @returns カード要素
 */
export function createSpotCard(opts: SpotCardOptions): HTMLElement {
  const log = logger.fn('createSpotCard', { spotId: opts.spotId, status: opts.status, meters: opts.meters });
  const name = opts.status === 'unknown' || opts.name === undefined ? UNKNOWN_SPOT_NAME : opts.name;
  const sub = [opts.meters === undefined ? undefined : formatDistance(opts.meters), opts.subtitle].filter((s): s is string => s !== undefined && s.length > 0).join(' ・ ');
  const content = [
    opts.icon ?? createSpotStatusIcon(opts.status),
    h('span', { class: 'spot-card__body' }, [
      h('span', { class: 'spot-card__head' }, [
        h('span', { class: 'spot-card__name', text: name }),
        h('span', { class: ['tag', 'tag--district'], text: opts.kindLabel }),
        opts.badge === undefined ? undefined : h('span', { class: ['tag', 'tag--accent'], text: opts.badge }),
      ]),
      sub.length === 0 && (opts.chips ?? []).length === 0
        ? undefined
        : h('span', { class: 'spot-card__subline' }, [
            sub.length === 0 ? undefined : h('span', { class: 'spot-card__sub', text: sub }),
            ...(opts.chips ?? []).map((chip) => h('span', { class: ['tag', 'tag--deadline'], text: chip })),
          ]),
    ]),
    opts.onClick === undefined ? undefined : h('span', { class: 'card-chevron', attrs: { 'aria-hidden': 'true' } }, [createIcon('chevronRight')]),
  ];
  const onClick = opts.onClick;
  const attrs = { 'data-testid': 'spot-card', 'data-status': opts.status, 'data-spot-id': opts.spotId, 'data-district-id': opts.districtId };
  const card =
    onClick === undefined
      ? h('div', { class: ['card', 'spot-card'], attrs }, content)
      : h('button', { class: ['card', 'spot-card'], attrs: { ...attrs, type: 'button' }, on: { click: userAction('spot-card', onClick) } }, content);
  return log.exit(card);
}
