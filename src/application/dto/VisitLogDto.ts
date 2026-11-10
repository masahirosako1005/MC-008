/**
 * @file 記録（訪問の年表と思い出）の DTO（application 層）
 * 図鑑画面の「記録」で使う（CLAUDE.md 6.5）。いつ・どこへ行ったかを新しい順に並べ、各回に自分の写真とメモ（思い出）を付けられる。基準 C。
 * プリミティブのみ（docs/08 §4.3）。座標は含めない（PRV-03）。達成率は含めない。
 */
import type { SeasonDto, SpotKindDto } from '@/application/dto/Dto';

/** 記録の1件（1回の訪問） */
export interface VisitLogEntryDto {
  readonly spotId: string;
  readonly spotName: string;
  readonly kind: SpotKindDto;
  readonly category: string;
  readonly districtId: string;
  readonly districtName: string;
  /** 地区の色（CSS の色。地区の丸に使う） */
  readonly districtColor: string;
  /** 訪問した JST 暦日（'YYYY-MM-DD'。思い出の保存キーになる） */
  readonly localDate: string;
  /** 表示用の日付（'11/2（月）'） */
  readonly dateLabel: string;
  /** 月の区切り（'YYYY-MM'） */
  readonly monthKey: string;
  /** 月の見出し（'2026年11月'） */
  readonly monthLabel: string;
  /** 訪問した時刻（'H:mm'） */
  readonly time: string;
  /** このスポットで何回目の訪問か（1 から） */
  readonly nth: number;
  readonly season: SeasonDto;
  /** 思い出のメモ（無ければ undefined） */
  readonly note?: string;
  /** 思い出の写真（JPEG の data URL。無ければ undefined） */
  readonly photo?: string;
}

/** 記録の全体 */
export interface VisitLogDto {
  /** 訪問の一覧（新しい順） */
  readonly entries: readonly VisitLogEntryDto[];
  /** 保存している写真の枚数 */
  readonly photoCount: number;
  /** 保存できる写真の上限（仮） */
  readonly photoLimit: number;
  /** メモの文字数の上限（仮） */
  readonly noteMax: number;
  /** 写真（data URL）の文字数の上限（仮。画面はこれに収まるまで縮小・圧縮する） */
  readonly photoMaxChars: number;
}

/** 思い出を保存する入力（画面から来る値なので未検証） */
export interface SaveVisitMemoryInput {
  readonly spotId: string;
  /** 訪問した JST 暦日（'YYYY-MM-DD'） */
  readonly localDate: string;
  /** メモ（省略＝変えない、空文字＝消す） */
  readonly note?: string;
  /** 写真の data URL（省略＝変えない、null＝消す） */
  readonly photo?: string | null;
}

/** 思い出を保存した結果（保存後の中身） */
export interface SaveVisitMemoryOutput {
  readonly note?: string;
  readonly photo?: string;
  /** 保存後の写真の枚数 */
  readonly photoCount: number;
}
