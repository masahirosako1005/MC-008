/**
 * @file 訪問の思い出（自分の写真・メモ）を保存するユースケース（application 層・書込系）
 * 入力を信用しない（SEC-16）。実際に訪問した回（スポット＋暦日）にだけ付けられ、写真は JPEG の data URL だけ・大きさと枚数に上限（仮）。
 * 同じ入力を何度送っても結果は同じ（冪等＝DI-07）。訪問記録・EXP・図鑑は変えない（思い出を消しても何も減らない＝CLAUDE.md 5）。
 * メモ・写真の中身はログに出さない（長さだけ。PRV-03）。
 */
import { createLogger } from '@/Common/logging/logger';
import { AppError, fail, ok } from '@/Common/result/Result';
import type { Result } from '@/Common/result/Result';
import { parseSpotId } from '@/Common/types/Id';
import type { SpotId } from '@/Common/types/Id';
import { parseLocalDate } from '@/Common/utils/date';
import type { LocalDate } from '@/Common/utils/date';
import { isRecord } from '@/Common/utils/guards';
import type { UseCase } from '@/application/AppServices';
import type { SaveVisitMemoryInput, SaveVisitMemoryOutput } from '@/application/dto/VisitLogDto';
import type { SessionRepository } from '@/application/ports/SessionRepository';
import { isMemoryPhoto, MEMORY_ENTRY_LIMIT, MEMORY_NOTE_MAX, MEMORY_PHOTO_LIMIT } from '@/application/ports/VisitMemoryRepository';
import type { VisitMemory, VisitMemoryRepository } from '@/application/ports/VisitMemoryRepository';
import { loadActiveTraveler } from '@/application/usecases/shared/World';
import type { TravelerRepository } from '@/domain/exploration/TravelerRepository';
import type { Clock } from '@/domain/ports/Clock';

const logger = createLogger('application/usecases/spot/SaveVisitMemoryUseCase');

/** 訪問していない回に思い出を付けようとしたときの失敗コード */
export const VISIT_NOT_FOUND = 'VISIT_NOT_FOUND';

/** 写真・思い出の上限に達したときの失敗コード */
export const MEMORY_LIMIT_REACHED = 'MEMORY_LIMIT_REACHED';

/** メモから取り除く制御文字（改行・タブ以外） */
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** SaveVisitMemoryUseCase の依存 */
export interface SaveVisitMemoryDeps {
  readonly session: SessionRepository;
  readonly travelers: TravelerRepository;
  readonly memories: VisitMemoryRepository;
  readonly clock: Clock;
}

/** 検証済みの入力 */
interface ParsedInput {
  readonly spotId: SpotId;
  readonly localDate: LocalDate;
  /** undefined＝変えない、''＝消す */
  readonly note?: string;
  /** undefined＝変えない、null＝消す */
  readonly photo?: string | null;
}

/**
 * 入力の形が不正なときの失敗を作る。
 * @param rule 破った規則
 * @returns INVALID_INPUT の失敗
 */
function invalid(rule: string): Result<never> {
  return fail(AppError.of('INVALID_INPUT', '思い出の内容が正しくありません', { rule }));
}

/**
 * メモを整える（制御文字を除き、前後の空白を落とす）。
 * @param raw 入力のメモ
 * @returns 整えたメモ
 */
export function normalizeNote(raw: string): string {
  const log = logger.fn('normalizeNote', { length: raw.length });
  return log.exit(raw.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim(), 'normalized');
}

/**
 * 入力を検証する（ID・日付・メモの長さ・写真の形と大きさ）。
 * @param input 未検証の入力
 * @returns 成功: 検証済みの入力。失敗: INVALID_INPUT
 */
function parseInput(input: unknown): Result<ParsedInput> {
  const log = logger.fn('parseInput');
  if (!isRecord(input)) return log.fail(invalid('shape'));
  const spotId = parseSpotId(input['spotId']);
  if (!spotId.ok) return log.fail(invalid('spotId'));
  const localDate = parseLocalDate(input['localDate']);
  if (!localDate.ok) return log.fail(invalid('localDate'));
  const rawNote = input['note'];
  if (rawNote !== undefined && typeof rawNote !== 'string') return log.fail(invalid('note'));
  const note = rawNote === undefined ? undefined : normalizeNote(rawNote);
  if (note !== undefined && [...note].length > MEMORY_NOTE_MAX) return log.fail(invalid('noteLength'));
  const photo = input['photo'];
  if (photo !== undefined && photo !== null && !isMemoryPhoto(photo)) return log.fail(invalid('photo'));
  return log.exit(
    ok({ spotId: spotId.value, localDate: localDate.value, ...(note === undefined ? {} : { note }), ...(photo === undefined ? {} : { photo: photo as string | null }) }),
  );
}

/**
 * いまの思い出に入力を重ねる（省略した項目は変えない。メモも写真も無くなれば undefined＝消す）。
 * @param current 保存済みの思い出（無ければ undefined）
 * @param input 検証済みの入力
 * @param clock 時計（更新日時）
 * @returns 保存する思い出。消すなら undefined
 */
function mergeMemory(current: VisitMemory | undefined, input: ParsedInput, clock: Clock): VisitMemory | undefined {
  const log = logger.fn('mergeMemory', { hadMemory: current !== undefined });
  const note = input.note === undefined ? current?.note : input.note === '' ? undefined : input.note;
  const photo = input.photo === undefined ? current?.photo : input.photo === null ? undefined : input.photo;
  if (note === undefined && photo === undefined) return log.exit(undefined, '消す');
  return log.exit(
    Object.freeze({ spotId: input.spotId, localDate: input.localDate, ...(note === undefined ? {} : { note }), ...(photo === undefined ? {} : { photo }), updatedAt: clock.now() }),
  );
}

/** 訪問の思い出を保存する */
export class SaveVisitMemoryUseCase implements UseCase<SaveVisitMemoryInput, SaveVisitMemoryOutput> {
  /**
   * 依存を受け取る。
   * @param deps セッション・旅人リポジトリ・思い出のリポジトリ・時計
   */
  constructor(private readonly deps: SaveVisitMemoryDeps) {}

  /**
   * 訪問した回にメモ・写真を付ける（省略した項目は変えない。両方無くなれば思い出を消す）。
   * @param input スポット・暦日・メモ・写真（画面から来る未検証の値）
   * @returns 成功: 保存後の中身と写真の枚数。
   *          失敗: INVALID_INPUT／VISIT_NOT_FOUND（訪問していない回）／MEMORY_LIMIT_REACHED（写真・件数の上限）／TRAVELER_NOT_FOUND／STORAGE_FAILED
   * @sideEffect 思い出のリポジトリに書き込む
   */
  async execute(input: SaveVisitMemoryInput): Promise<Result<SaveVisitMemoryOutput>> {
    const log = logger.fn('execute', { noteLength: input?.note?.length, hasPhoto: typeof input?.photo === 'string' });
    const parsed = parseInput(input);
    if (!parsed.ok) return log.fail(parsed);
    const { spotId, localDate } = parsed.value;
    const traveler = await loadActiveTraveler(this.deps);
    if (!traveler.ok) return log.fail(traveler);
    if (!traveler.value.hasVisitedOn(spotId, localDate)) {
      return log.fail(fail(AppError.of(VISIT_NOT_FOUND, 'この日の訪問が見つかりません', { spotId, localDate })));
    }
    const loaded = await this.deps.memories.list(traveler.value.id);
    if (!loaded.ok) return log.fail(loaded);
    const current = loaded.value.find((m) => m.spotId === spotId && m.localDate === localDate);
    const others = loaded.value.filter((m) => m !== current);
    const next = mergeMemory(current, parsed.value, this.deps.clock);
    const otherPhotos = others.filter((m) => m.photo !== undefined).length;
    if (next?.photo !== undefined && current?.photo === undefined && otherPhotos >= MEMORY_PHOTO_LIMIT) {
      return log.fail(fail(AppError.of(MEMORY_LIMIT_REACHED, `写真は${MEMORY_PHOTO_LIMIT}枚まで保存できます`, { limit: MEMORY_PHOTO_LIMIT })));
    }
    if (next !== undefined && current === undefined && others.length >= MEMORY_ENTRY_LIMIT) {
      return log.fail(fail(AppError.of(MEMORY_LIMIT_REACHED, 'これ以上は保存できません', { limit: MEMORY_ENTRY_LIMIT })));
    }
    const saved = await this.deps.memories.saveAll(traveler.value.id, next === undefined ? others : [...others, next]);
    if (!saved.ok) return log.fail(saved);
    const output: SaveVisitMemoryOutput = Object.freeze({
      ...(next?.note === undefined ? {} : { note: next.note }),
      ...(next?.photo === undefined ? {} : { photo: next.photo }),
      photoCount: otherPhotos + (next?.photo === undefined ? 0 : 1),
    });
    return log.exit(ok(output), next === undefined ? 'removed' : 'saved');
  }
}
