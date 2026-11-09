/**
 * @file マスタデータの読込（infrastructure/master 層）
 * public/master の7ファイル（地区・名所・店舗・クーポン/イベント・ライバル・地図の背景・便利施設ポイント）を並列に取得
 * → （任意で SHA-256 照合）→ JSON.parse → masterValidators で検証し、
 * SpotRepository（InMemorySpotRepository。地図の背景も持つ）と RivalRepository（StaticRivalRepository）を作る（DI-13, SEC-22）。
 * 1つでも失敗したら起動を中止できるよう失敗を返す（部分的なマスタで動かさない）。
 * ハッシュ照合（masterHashes.ts）は PoC では既定で無効（docs/08 §8）。verifyHashes: true で有効にする。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import type { RivalRepository } from '@/domain/competition/RivalRepository';
import type { SpotRepository } from '@/domain/spot/SpotRepository';
import { parseJsonText } from '@/infrastructure/json/parseJsonText';
import { InMemorySpotRepository } from '@/infrastructure/master/InMemorySpotRepository';
import { MASTER_HASHES } from '@/infrastructure/master/masterHashes';
import { MASTER_FILE_NAMES, masterInvalid, validateMaster } from '@/infrastructure/master/masterValidators';
import type { MasterError, MasterErrorCode, MasterFileKey, MasterJson, SpotCatalog } from '@/infrastructure/master/masterValidators';
import { StaticRivalRepository } from '@/infrastructure/master/StaticRivalRepository';

const logger = createLogger('infrastructure/master/MasterDataLoader');

/** ファイル名（例: 'districts.json'）を受け取り本文を返す取得関数（ブラウザでは browserFetchText） */
export type FetchText = (fileName: string) => Promise<Result<string>>;

/** 本文の SHA-256（16進・小文字）を返す関数 */
export type DigestText = (text: string) => Promise<Result<string>>;

/** 読込結果 */
export interface LoadedMaster {
  readonly spots: SpotRepository;
  readonly rivals: RivalRepository;
  /** 検証済みのスポット・地区・クーポン/イベント（デモで店舗CMS の登録内容を重ねる元＝docs/09 APP-11） */
  readonly catalog: SpotCatalog;
}

/** MasterDataLoader の設定 */
export interface MasterDataLoaderOptions {
  /** true なら masterHashes.ts の SHA-256 と照合し、一致しないファイルを拒否する（既定 false＝PoC） */
  readonly verifyHashes?: boolean;
  /** 照合に使うハッシュ表（既定 MASTER_HASHES） */
  readonly hashes?: Readonly<Record<string, string>>;
  /** ハッシュ関数（既定 sha256Hex＝crypto.subtle） */
  readonly digest?: DigestText;
}

/** ファイルの種類と本文 */
type MasterTexts = Readonly<Record<MasterFileKey, string>>;

/** 読込順のファイルの種類 */
const FILE_KEYS: readonly MasterFileKey[] = Object.freeze(['districts', 'landmarks', 'shops', 'shopEvents', 'rivals', 'mapFeatures', 'amenityPoints']);

/**
 * 本文の SHA-256 を 16進小文字で返す（crypto.subtle.digest）。
 * @param text 本文（UTF-8 でバイト列にする）
 * @returns 成功: 64桁の16進。失敗: MASTER_INVALID（crypto.subtle が使えない）
 */
export async function sha256Hex(text: string): Promise<Result<string>> {
  const log = logger.fn('sha256Hex', { length: text.length });
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    return log.exit(ok(hex));
  } catch (error) {
    log.error('SHA-256 を計算できません');
    return log.fail(fail(AppError.of<MasterErrorCode>('MASTER_INVALID', 'マスタデータを検証できません', { rule: 'digest' }, error)));
  }
}

/**
 * マスタ取得失敗の Result を作る。
 * @param fileName ファイル名
 * @param cause 元の失敗・例外（ログ用。画面に出さない）
 * @returns MASTER_FETCH_FAILED の失敗
 */
function fetchFailed(fileName: string, cause?: unknown): Result<never, MasterError> {
  return fail(AppError.of<MasterErrorCode>('MASTER_FETCH_FAILED', 'マスタデータを取得できませんでした', { file: fileName }, cause));
}

/**
 * 取得関数を呼び、例外（reject）も失敗にする。
 * @param fetchText 取得関数
 * @param fileName ファイル名
 * @returns 成功: 本文。失敗: MASTER_FETCH_FAILED
 */
async function fetchOne(fetchText: FetchText, fileName: string): Promise<Result<string, MasterError>> {
  const log = logger.fn('fetchOne', { fileName });
  try {
    const fetched = await fetchText(fileName);
    return fetched.ok ? log.exit(ok(fetched.value), `length=${fetched.value.length}`) : log.fail(fetchFailed(fileName, fetched.error));
  } catch (error) {
    log.error('マスタの取得で例外', { fileName });
    return log.fail(fetchFailed(fileName, error));
  }
}

/** マスタデータの読込 */
export class MasterDataLoader {
  /**
   * 読込器を作る。
   * @param options ハッシュ照合の有無・ハッシュ表・ハッシュ関数
   */
  constructor(private readonly options: MasterDataLoaderOptions = {}) {}

  /**
   * 既定の設定で読み込む（`MasterDataLoader.load(fetchText)` と書ける短縮形）。
   * @param fetchText ファイル名 → 本文の取得関数
   * @param options 読込器の設定（省略可）
   * @returns インスタンスの load と同じ
   */
  static load(fetchText: FetchText, options: MasterDataLoaderOptions = {}): Promise<Result<LoadedMaster, MasterError>> {
    return new MasterDataLoader(options).load(fetchText);
  }

  /**
   * 7ファイルを並列に取得して検証し、リポジトリを作る。
   * @param fetchText ファイル名 → 本文の取得関数
   * @returns 成功: SpotRepository と RivalRepository。失敗: MASTER_FETCH_FAILED（取得失敗）/ MASTER_INVALID（ハッシュ不一致・JSON 不正・検証違反）
   * @sideEffect fetchText を7回呼ぶ（ネットワーク）
   * @see docs/06 DI-13, docs/05 SEC-22
   */
  async load(fetchText: FetchText): Promise<Result<LoadedMaster, MasterError>> {
    const log = logger.fn('load', { verifyHashes: this.options.verifyHashes === true });
    const texts = await this.fetchAll(fetchText);
    if (!texts.ok) return log.fail(texts);
    if (this.options.verifyHashes === true) {
      const verified = await this.verifyHashes(texts.value);
      if (!verified.ok) return log.fail(verified);
    }
    const json = parseAll(texts.value);
    if (!json.ok) return log.fail(json);
    const master = validateMaster(json.value);
    if (!master.ok) return log.fail(master);
    log.info('マスタ読込完了', {
      spots: master.value.spots.length, shopEvents: master.value.shopEvents.length, rivals: master.value.rivals.length,
      features: master.value.backdrop.features.length, amenityPoints: master.value.backdrop.amenityPoints.length,
    });
    return log.exit(ok({ spots: new InMemorySpotRepository(master.value), rivals: new StaticRivalRepository(master.value.rivals), catalog: master.value }));
  }

  /**
   * 7ファイルを並列に取得する。
   * @param fetchText 取得関数
   * @returns 成功: 種類 → 本文。失敗: MASTER_FETCH_FAILED（最初に失敗したファイル）
   */
  private async fetchAll(fetchText: FetchText): Promise<Result<MasterTexts, MasterError>> {
    const log = logger.fn('fetchAll');
    const results = await Promise.all(FILE_KEYS.map((key) => fetchOne(fetchText, MASTER_FILE_NAMES[key])));
    const texts: Partial<Record<MasterFileKey, string>> = {};
    for (const [index, key] of FILE_KEYS.entries()) {
      const result = results[index];
      if (result === undefined) return log.fail(masterInvalid(MASTER_FILE_NAMES[key], 'missing'));
      if (!result.ok) return log.fail(result);
      texts[key] = result.value;
    }
    return log.exit(ok({
      districts: texts.districts ?? '', landmarks: texts.landmarks ?? '', shops: texts.shops ?? '', shopEvents: texts.shopEvents ?? '',
      rivals: texts.rivals ?? '', mapFeatures: texts.mapFeatures ?? '', amenityPoints: texts.amenityPoints ?? '',
    }));
  }

  /**
   * 各ファイルの SHA-256 をハッシュ表と照合する。
   * @param texts 種類 → 本文
   * @returns 成功: void。失敗: MASTER_INVALID（rule: 'hash'。ハッシュ表に無いファイルも不一致とみなす）
   */
  private async verifyHashes(texts: MasterTexts): Promise<Result<void, MasterError>> {
    const log = logger.fn('verifyHashes');
    const hashes = this.options.hashes ?? MASTER_HASHES;
    const digest = this.options.digest ?? sha256Hex;
    for (const key of FILE_KEYS) {
      const file = MASTER_FILE_NAMES[key];
      const actual = await digest(texts[key]);
      if (!actual.ok || actual.value !== hashes[file]) {
        log.error('マスタのハッシュが一致しません', { file });
        return log.fail(masterInvalid(file, 'hash'));
      }
    }
    return log.exit(ok(undefined));
  }
}

/**
 * 7ファイルの本文を JSON.parse する。
 * @param texts 種類 → 本文
 * @returns 成功: 種類 → パース結果（未検証）。失敗: MASTER_INVALID（rule: 'json'）
 */
function parseAll(texts: MasterTexts): Result<MasterJson, MasterError> {
  const log = logger.fn('parseAll');
  const parsed: Partial<Record<MasterFileKey, unknown>> = {};
  for (const key of FILE_KEYS) {
    const json = parseJsonText(texts[key], MASTER_FILE_NAMES[key]);
    if (!json.ok) return log.fail(masterInvalid(MASTER_FILE_NAMES[key], 'json'));
    parsed[key] = json.value;
  }
  return log.exit(ok({
    districts: parsed.districts, landmarks: parsed.landmarks, shops: parsed.shops, shopEvents: parsed.shopEvents, rivals: parsed.rivals,
    mapFeatures: parsed.mapFeatures, amenityPoints: parsed.amenityPoints,
  }));
}
