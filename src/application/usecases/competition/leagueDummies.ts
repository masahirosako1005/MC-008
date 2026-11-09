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
    ['旅人タロウ', 16], ['旅人ハナ', 13], ['旅人ケン', 11], ['旅人ミオ', 9], ['旅人ソラ', 8],
    ['旅人リク', 7], ['旅人アオイ', 5], ['旅人チヒロ', 3], ['旅人ゴロウ', 2], ['旅人マキ', 1],
  ]),
  // 新しいスポットを開拓する人たち。常連は伸びにくく、初めての人ほど伸びる
  hajimete: dummies('hajimete', [
    ['旅人ナギ', 6], ['旅人ユイ', 5], ['旅人チヒロ', 4], ['旅人ハル', 4], ['旅人メイ', 3],
    ['旅人リク', 2], ['旅人コウ', 2], ['旅人タロウ', 1], ['旅人ハナ', 1], ['旅人サキ', 0],
  ]),
  // 使いはじめて30日以内の人たち
  rookie: dummies('rookie', [
    ['旅人ユイ', 5], ['旅人ナギ', 4], ['旅人ハル', 3], ['旅人メイ', 3], ['旅人コウ', 2],
    ['旅人サキ', 2], ['旅人レン', 1], ['旅人モモ', 1], ['旅人イオ', 0], ['旅人ツムギ', 0],
  ]),
});
