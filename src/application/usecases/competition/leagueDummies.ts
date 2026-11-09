/**
 * @file リーグのダミー参加者（application 層・PoC 用の固定データ）
 * 実ユーザーの代わりに各リーグ10人分の今月の数値を置く（すべて（仮））。旅人（あなた）の行は実際の訪問記録から数えて差し込む。
 * かよいリーグには模擬ライバル（public/master/rivals.json）と同じ名前を入れ、「地区の主」タグと見た目をそろえる。
 * 数値は「初めての人が1〜3回訪れると中位〜上位に届く」ように置く（ルーキー・はじめまして）。かよいリーグは通い慣れた人向けの水準。
 * 本番では REST のランキング API に置き換える（docs/08 §4.3）。
 */
import type { LeagueId } from '@/domain/competition/League';

/** ダミー参加者 */
export interface LeagueDummy {
  /** 一意なキー（'dummy:<リーグ>:<n>'） */
  readonly key: string;
  readonly name: string;
  /** 今月の数値（回 または か所） */
  readonly count: number;
}

/**
 * 名前と数値の組からダミー参加者の配列を作る。
 * @param leagueId リーグ
 * @param rows [名前, 数値] の配列
 * @returns ダミー参加者（凍結済み）
 */
function dummies(leagueId: LeagueId, rows: readonly (readonly [string, number])[]): readonly LeagueDummy[] { // audit-ignore: fnlog-missing モジュール読込時に3回だけ呼ぶ固定データの組立て
  return Object.freeze(rows.map(([name, count], i) => Object.freeze({ key: `dummy:${leagueId}:${i + 1}`, name, count })));
}

/** リーグごとのダミー参加者（各10人）（仮） */
export const LEAGUE_DUMMIES: Readonly<Record<LeagueId, readonly LeagueDummy[]>> = Object.freeze({
  // 通い慣れた人たち。月の前半を想定した回数
  kayoi: dummies('kayoi', [
    ['おまいり番長', 16], ['花見は毎日派', 13], ['天六の生き字引', 11], ['みおつくし', 9], ['中崎町カフェ部', 8],
    ['商店街踏破中', 7], ['親子でてくてく', 5], ['コロッケ評論家', 3], ['早起きは三文', 2], ['月イチ散歩', 1],
  ]),
  // 新しいスポットを開拓する人たち。常連は伸びにくく、初めての人ほど伸びる
  hajimete: dummies('hajimete', [
    ['路地裏コンパス', 6], ['寄り道の天才', 5], ['コロッケ評論家', 4], ['迷子も楽しむ派', 4], ['週末デビュー', 3],
    ['商店街踏破中', 2], ['ベビーカー隊長', 2], ['おまいり番長', 1], ['花見は毎日派', 1], ['まずは近所から', 0],
  ]),
  // 使いはじめて30日以内の人たち
  rookie: dummies('rookie', [
    ['寄り道の天才', 5], ['路地裏コンパス', 4], ['迷子も楽しむ派', 3], ['週末デビュー', 3], ['ベビーカー隊長', 2],
    ['まずは近所から', 2], ['新米さんぽ', 1], ['おためし中', 1], ['これから本気', 0], ['雨の日待機中', 0],
  ]),
});
