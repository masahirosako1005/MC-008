/**
 * @file 書き出したファイルから、端末の利用者のデータを復元するユースケース（application 層・書込系。DI-21）
 * 設定画面の「読み込む」→ 確認ダイアログの「置き換える」で使う。ExportDataUseCase が作った JSON だけを受け付ける。
 * ファイルは外から来るデータなので、置き換える前にすべて確かめる（DI-01）：形式名・形式の版・ビルド（デモ／本番を混ぜない＝DI-23）・件数・キーの書式。
 * 1つでも合わなければ何も変えない。書き込みの途中で失敗したときは DataPort が元の内容に戻す（DI-12）。
 * 個々の値（旅人・台帳など）の中身は、読み込み直した後に各リポジトリの parse が確かめる（版が違う・壊れた値は読まずに退避＝DI-15）。
 * これは利用者が自分の意思で端末のデータを入れ替える手段で、ゲームの仕組みで進み具合を減らす操作ではない（CLAUDE.md 5 章。全削除と同じ扱い）。
 * 監査のため、置き換えたこと（件数のみ）を warn で残す（DI-20）。中身はログに出さない。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { ImportDataInput, ImportDataOutput } from '@/application/dto/SettingsDto';
import type { DataPort, UserDataEntry } from '@/application/ports/DataPort';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION } from '@/application/usecases/settings/ExportDataUseCase';

const logger = createLogger('application/usecases/settings/ImportDataUseCase');

/** 読み込むファイルの文字数の上限（仮。localStorage の容量＝約500万文字を超えるものは書けない） */
export const IMPORT_MAX_CHARS = 6_000_000;

/** 読み込む保存データの件数の上限（仮） */
export const IMPORT_MAX_ENTRIES = 2000;

/** キーの書式（英数字で始まり、英数字と . _ : - だけ。'traveler.t_xxx'・'map.prefs' など） */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** ImportDataUseCase の依存 */
export interface ImportDataDeps {
  readonly userData: DataPort;
  /** デモビルドなら true（デモのファイルはデモにだけ、本番のファイルは本番にだけ読み込む） */
  readonly demo: boolean;
  /** JSON 文字列を読む（例外を Result にする境界。実装は infrastructure/json/parseJsonText） */
  readonly parseJson: (text: string) => Result<unknown>;
}

/**
 * 読み込めない理由を INVALID_INPUT にする。
 * @param rule 合わなかった決まり（size／json／format／version／build／entries／count／key）
 * @returns 失敗の Result
 */
function rejected(rule: string): Result<never> {
  return logger.fn('rejected', { rule }).exit(fail(AppError.of('INVALID_INPUT', 'このファイルは読み込めません', { field: 'content', rule })));
}

/**
 * 値が配列でないオブジェクトか判定する。
 * @param value 調べる値
 * @returns オブジェクトなら true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return logger.fn('isRecord').exit(typeof value === 'object' && value !== null && !Array.isArray(value));
}

/**
 * 書き出しファイルの中身（JSON を読んだ後の値）を確かめ、保存データの並びにする。
 * @param document JSON を読んだ値（未検証）
 * @param demo このビルドがデモか
 * @returns 成功: キーと値の一覧。失敗: INVALID_INPUT（details.rule に合わなかった決まり）
 */
export function parseExportDocument(document: unknown, demo: boolean): Result<readonly UserDataEntry[]> {
  const log = logger.fn('parseExportDocument', { demo });
  if (!isRecord(document) || document['format'] !== EXPORT_FORMAT) return log.fail(rejected('format'));
  if (document['formatVersion'] !== EXPORT_FORMAT_VERSION) return log.fail(rejected('version'));
  if (document['build'] !== (demo ? 'demo' : 'production')) return log.fail(rejected('build'));
  const entries = document['entries'];
  if (!isRecord(entries)) return log.fail(rejected('entries'));
  const keys = Object.keys(entries);
  if (keys.length === 0 || keys.length > IMPORT_MAX_ENTRIES) return log.fail(rejected('count'));
  if (!keys.every((key) => KEY_PATTERN.test(key))) return log.fail(rejected('key'));
  return log.exit(ok(keys.map((key) => ({ key, value: entries[key] }))), `count=${keys.length}`);
}

/** 書き出したファイルから利用者のデータを復元する */
export class ImportDataUseCase implements UseCase<ImportDataInput, ImportDataOutput> {
  /**
   * 依存を受け取る。
   * @param deps データ全体のポート・デモかどうか・JSON の読み取り
   */
  constructor(private readonly deps: ImportDataDeps) {}

  /**
   * 確認済みなら、ファイルの中身を確かめてから、保存データをまるごと置き換える。
   * @param input ファイルの中身と確認済みか
   * @returns 成功: 書いた件数。失敗: INVALID_INPUT（未確認・ファイルが合わない。何も変えない）／STORAGE_FAILED（書けなかった。元の内容に戻している）
   * @sideEffect 保存データを置き換える
   */
  async execute(input: ImportDataInput): Promise<Result<ImportDataOutput>> {
    const log = logger.fn('execute', { confirmed: input.confirmed, length: input.content.length });
    if (input.confirmed !== true) {
      return log.fail(fail(AppError.of('INVALID_INPUT', '読み込みの確認が済んでいません', { field: 'confirmed' })), '未確認');
    }
    if (input.content.length === 0 || input.content.length > IMPORT_MAX_CHARS) return log.fail(rejected('size'));
    const json = this.deps.parseJson(input.content);
    if (!json.ok) return log.fail(rejected('json'));
    const entries = parseExportDocument(json.value, this.deps.demo);
    if (!entries.ok) return log.fail(entries);
    const replaced = await this.deps.userData.replaceAll(entries.value);
    if (!replaced.ok) return log.fail(replaced);
    log.warn('利用者の操作で、端末の保存データを書き出しファイルの内容に置き換えました（DI-21）', { written: replaced.value.written });
    return log.exit(ok({ written: replaced.value.written }));
  }
}
