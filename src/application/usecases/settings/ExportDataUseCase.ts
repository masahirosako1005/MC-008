/**
 * @file 端末に保存した利用者のデータを JSON に書き出すユースケース（application 層・読取系。DI-21）
 * 設定画面の「データを書き出す」で使う。DataPort が返す範囲（店舗CMS の登録内容は含まない）を1つの JSON にまとめる。
 * 保存データに生の座標は無い（PRV-03）ので、書き出しにも含まれない。中身はログに出さない（件数だけ）。
 */
import { createLogger } from '@/Common/logging/logger';
import { ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { UseCase } from '@/application/AppServices';
import type { ExportDataDto } from '@/application/dto/SettingsDto';
import type { DataPort } from '@/application/ports/DataPort';
import type { Clock } from '@/domain/ports/Clock';

const logger = createLogger('application/usecases/settings/ExportDataUseCase');

/** 書き出しファイルの形式名（読み込むときに形式を判定する） */
export const EXPORT_FORMAT = 'kayoimachi-user-data';

/** 書き出しファイルの形式の版 */
export const EXPORT_FORMAT_VERSION = 1;

/** ExportDataUseCase の依存 */
export interface ExportDataDeps {
  readonly userData: DataPort;
  readonly clock: Clock;
  /** デモビルドなら true（ファイル名と中身にデモと記す） */
  readonly demo: boolean;
}

/** 利用者のデータを JSON に書き出す */
export class ExportDataUseCase implements UseCase<void, ExportDataDto> {
  /**
   * 依存を受け取る。
   * @param deps データ全体のポート・時計・デモかどうか
   */
  constructor(private readonly deps: ExportDataDeps) {}

  /**
   * 保存データを読み、ファイル名と JSON の中身を返す（ファイルの保存は画面が行う）。
   * @returns 成功: ファイル名・中身・件数。失敗: STORAGE_FAILED
   */
  async execute(): Promise<Result<ExportDataDto>> {
    const log = logger.fn('execute', { demo: this.deps.demo });
    const loaded = await this.deps.userData.readAll();
    if (!loaded.ok) return log.fail(loaded);
    const entries: Record<string, unknown> = {};
    for (const entry of loaded.value) entries[entry.key] = entry.value;
    const document = {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: this.deps.clock.now(),
      build: this.deps.demo ? 'demo' : 'production',
      entries,
    };
    const filename = `machiquest-${this.deps.demo ? 'demo-' : ''}data-${this.deps.clock.today()}.json`;
    log.info('データを書き出しました', { entryCount: loaded.value.length });
    return log.exit(ok({ filename, content: `${JSON.stringify(document, null, 2)}\n`, entryCount: loaded.value.length }));
  }
}
